// Package main independently derives the complete verification matrix from BIP39 seeds.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/btcutil/base58"
	"github.com/btcsuite/btcd/btcutil/hdkeychain"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/txscript"
	"github.com/tyler-smith/go-bip39"
)

const implementationVersion = "btcd 0.25.0 + go-bip39 1.1.0"

var slip132Versions = map[string][]byte{
	"xpub": {0x04, 0x88, 0xb2, 0x1e}, "ypub": {0x04, 0x9d, 0x7c, 0xb2},
	"zpub": {0x04, 0xb2, 0x47, 0x46}, "Ypub": {0x02, 0x95, 0xb4, 0x3f},
	"Zpub": {0x02, 0xaa, 0x7e, 0xd3}, "tpub": {0x04, 0x35, 0x87, 0xcf},
	"upub": {0x04, 0x4a, 0x52, 0x62}, "vpub": {0x04, 0x5f, 0x1c, 0xf6},
	"Upub": {0x02, 0x42, 0x89, 0xef}, "Vpub": {0x02, 0x57, 0x54, 0x83},
}

type seedRow struct {
	ID       string `json:"id"`
	Mnemonic string `json:"mnemonic"`
}

type derivationCase struct {
	ID            string   `json:"id"`
	Kind          string   `json:"kind"`
	Chain         string   `json:"chain"`
	ScriptType    string   `json:"scriptType"`
	AccountPath   string   `json:"accountPath"`
	Branch        uint32   `json:"branch"`
	Index         uint32   `json:"index"`
	SeedIDs       []string `json:"seedIds"`
	Slip132Format string   `json:"slip132Format"`
	Threshold     int      `json:"threshold"`
}

type request struct {
	Cases []derivationCase `json:"cases"`
	Seeds []seedRow        `json:"seeds"`
}

type accountEvidence struct {
	SeedID            string `json:"seedId"`
	MasterFingerprint string `json:"masterFingerprint"`
	OriginPath        string `json:"originPath"`
	Encoded           string `json:"encoded"`
	VersionHex        string `json:"versionHex"`
	Depth             uint8  `json:"depth"`
	ParentFingerprint string `json:"parentFingerprint"`
	ChildNumber       uint32 `json:"childNumber"`
	ChainCodeHex      string `json:"chainCodeHex"`
	PublicKeyHex      string `json:"publicKeyHex"`
	PayloadHex        string `json:"payloadHex"`
}

type evidence struct {
	CaseID                string            `json:"caseId"`
	Implementation        string            `json:"implementation"`
	ImplementationVersion string            `json:"implementationVersion"`
	EvidenceScope         string            `json:"evidenceScope"`
	AccountKeys           []accountEvidence `json:"accountKeys"`
	Address               string            `json:"address"`
	ScriptPubKeyHex       string            `json:"scriptPubKeyHex"`
}

type response struct {
	Available      bool       `json:"available,omitempty"`
	Version        string     `json:"version,omitempty"`
	RuntimeVersion string     `json:"runtimeVersion,omitempty"`
	Evidence       []evidence `json:"evidence,omitempty"`
	Error          string     `json:"error,omitempty"`
}

func main() {
	if len(os.Args) != 2 {
		output(response{Error: "usage: go-verify.go check|batch"})
		return
	}
	if os.Args[1] == "check" {
		output(response{Available: true, Version: implementationVersion, RuntimeVersion: runtime.Version()})
		return
	}
	if os.Args[1] != "batch" {
		output(response{Error: "unknown command: " + os.Args[1]})
		return
	}
	var input request
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		output(response{Error: "invalid batch request: " + err.Error()})
		return
	}
	result, err := deriveBatch(input)
	if err != nil {
		output(response{Error: err.Error()})
		return
	}
	output(response{Evidence: result})
}

func output(value response) {
	_ = json.NewEncoder(os.Stdout).Encode(value)
}

func deriveBatch(input request) ([]evidence, error) {
	seeds := make(map[string]string, len(input.Seeds))
	for _, row := range input.Seeds {
		seeds[row.ID] = row.Mnemonic
	}
	result := make([]evidence, 0, len(input.Cases))
	for _, testCase := range input.Cases {
		derived, err := deriveCase(testCase, seeds)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", testCase.ID, err)
		}
		result = append(result, derived)
	}
	return result, nil
}

func deriveCase(testCase derivationCase, mnemonics map[string]string) (evidence, error) {
	accountKeys := make([]accountEvidence, 0, len(testCase.SeedIDs))
	pubKeys := make([][]byte, 0, len(testCase.SeedIDs))
	seenSeedIDs := make(map[string]struct{}, len(testCase.SeedIDs))
	seenAccountKeys := make(map[string]struct{}, len(testCase.SeedIDs))
	for _, seedID := range testCase.SeedIDs {
		if _, exists := seenSeedIDs[seedID]; exists {
			return evidence{}, fmt.Errorf("duplicate seed-derived account key in %s", testCase.ID)
		}
		seenSeedIDs[seedID] = struct{}{}
		mnemonic, ok := mnemonics[seedID]
		if !ok || !bip39.IsMnemonicValid(mnemonic) {
			return evidence{}, fmt.Errorf("missing or invalid mnemonic for %s", seedID)
		}
		root, account, err := deriveAccount(bip39.NewSeed(mnemonic, ""), testCase)
		if err != nil {
			return evidence{}, err
		}
		keyEvidence, err := makeAccountEvidence(seedID, root, account, testCase)
		if err != nil {
			return evidence{}, err
		}
		keyIdentity := keyEvidence.ChainCodeHex + ":" + keyEvidence.PublicKeyHex
		if _, exists := seenAccountKeys[keyIdentity]; exists {
			return evidence{}, fmt.Errorf("duplicate derived account key material in %s", testCase.ID)
		}
		seenAccountKeys[keyIdentity] = struct{}{}
		child, err := account.Derive(testCase.Branch)
		if err == nil {
			child, err = child.Derive(testCase.Index)
		}
		if err != nil {
			return evidence{}, fmt.Errorf("derive branch/index: %w", err)
		}
		pubKey, err := child.ECPubKey()
		if err != nil {
			return evidence{}, fmt.Errorf("read child public key: %w", err)
		}
		accountKeys = append(accountKeys, keyEvidence)
		pubKeys = append(pubKeys, pubKey.SerializeCompressed())
	}
	address, script, err := deriveOutput(pubKeys, testCase)
	if err != nil {
		return evidence{}, err
	}
	return evidence{
		CaseID: testCase.ID, Implementation: "btcd/btcutil (Go)",
		ImplementationVersion: implementationVersion, EvidenceScope: "seed-to-account-and-output", AccountKeys: accountKeys,
		Address: address, ScriptPubKeyHex: hex.EncodeToString(script),
	}, nil
}

func deriveAccount(seed []byte, testCase derivationCase) (*hdkeychain.ExtendedKey, *hdkeychain.ExtendedKey, error) {
	root, err := hdkeychain.NewMaster(seed, familyParams(testCase.Chain))
	if err != nil {
		return nil, nil, fmt.Errorf("create BIP32 master: %w", err)
	}
	indices, err := parsePath(testCase.AccountPath)
	if err != nil {
		return nil, nil, err
	}
	node := root
	for _, index := range indices {
		node, err = node.Derive(index)
		if err != nil {
			return nil, nil, fmt.Errorf("derive account path: %w", err)
		}
	}
	return root, node, nil
}

func parsePath(path string) ([]uint32, error) {
	if !strings.HasPrefix(path, "m/") {
		return nil, fmt.Errorf("invalid absolute BIP32 path: %s", path)
	}
	parts := strings.Split(strings.TrimPrefix(path, "m/"), "/")
	indices := make([]uint32, 0, len(parts))
	for _, part := range parts {
		hardened := strings.HasSuffix(part, "'") || strings.HasSuffix(part, "h") || strings.HasSuffix(part, "H")
		if hardened {
			part = part[:len(part)-1]
		}
		parsed, err := strconv.ParseUint(part, 10, 31)
		if err != nil {
			return nil, fmt.Errorf("invalid BIP32 path component: %s", part)
		}
		index := uint32(parsed)
		if hardened {
			index += hdkeychain.HardenedKeyStart
		}
		indices = append(indices, index)
	}
	return indices, nil
}

func makeAccountEvidence(seedID string, root, account *hdkeychain.ExtendedKey, testCase derivationCase) (accountEvidence, error) {
	public, err := account.Neuter()
	if err != nil {
		return accountEvidence{}, fmt.Errorf("neuter account key: %w", err)
	}
	version, ok := slip132Versions[testCase.Slip132Format]
	if !ok {
		return accountEvidence{}, fmt.Errorf("unknown SLIP-132 format: %s", testCase.Slip132Format)
	}
	raw := base58.Decode(public.String())
	if len(raw) != 82 {
		return accountEvidence{}, fmt.Errorf("unexpected serialized account key length: %d", len(raw))
	}
	copy(raw[:4], version)
	checksum := doubleSHA256(raw[:78])
	copy(raw[78:], checksum[:4])
	rootPub, err := root.ECPubKey()
	if err != nil {
		return accountEvidence{}, fmt.Errorf("read master public key: %w", err)
	}
	payload := raw[4:78]
	return accountEvidence{
		SeedID: seedID, MasterFingerprint: hex.EncodeToString(btcutil.Hash160(rootPub.SerializeCompressed())[:4]),
		OriginPath: testCase.AccountPath, Encoded: base58.Encode(raw), VersionHex: hex.EncodeToString(version),
		Depth: payload[0], ParentFingerprint: hex.EncodeToString(payload[1:5]),
		ChildNumber: binary.BigEndian.Uint32(payload[5:9]), ChainCodeHex: hex.EncodeToString(payload[9:41]),
		PublicKeyHex: hex.EncodeToString(payload[41:74]), PayloadHex: hex.EncodeToString(payload),
	}, nil
}

func doubleSHA256(payload []byte) [32]byte {
	first := sha256.Sum256(payload)
	return sha256.Sum256(first[:])
}

func familyParams(chain string) *chaincfg.Params {
	if chain == "mainnet" {
		return &chaincfg.MainNetParams
	}
	return &chaincfg.TestNet3Params
}

func chainParams(chain string) (*chaincfg.Params, error) {
	switch chain {
	case "mainnet":
		return &chaincfg.MainNetParams, nil
	case "testnet3":
		return &chaincfg.TestNet3Params, nil
	case "testnet4":
		return &chaincfg.TestNet4Params, nil
	case "signet":
		return &chaincfg.SigNetParams, nil
	case "regtest":
		return &chaincfg.RegressionNetParams, nil
	default:
		return nil, fmt.Errorf("unsupported chain environment: %s", chain)
	}
}

func deriveOutput(pubKeys [][]byte, testCase derivationCase) (string, []byte, error) {
	net, err := chainParams(testCase.Chain)
	if err != nil {
		return "", nil, err
	}
	var address btcutil.Address
	if testCase.Kind == "single_sig" {
		address, err = singleAddress(pubKeys[0], testCase.ScriptType, net)
	} else {
		address, err = multisigAddress(pubKeys, testCase.Threshold, testCase.ScriptType, net)
	}
	if err != nil {
		return "", nil, err
	}
	script, err := txscript.PayToAddrScript(address)
	if err != nil {
		return "", nil, fmt.Errorf("build output script: %w", err)
	}
	return address.EncodeAddress(), script, nil
}

func singleAddress(pubKey []byte, scriptType string, net *chaincfg.Params) (btcutil.Address, error) {
	keyHash := btcutil.Hash160(pubKey)
	switch scriptType {
	case "legacy":
		return btcutil.NewAddressPubKeyHash(keyHash, net)
	case "native_segwit":
		return btcutil.NewAddressWitnessPubKeyHash(keyHash, net)
	case "nested_segwit":
		witness, err := btcutil.NewAddressWitnessPubKeyHash(keyHash, net)
		if err != nil {
			return nil, err
		}
		redeem, err := txscript.PayToAddrScript(witness)
		if err != nil {
			return nil, err
		}
		return btcutil.NewAddressScriptHash(redeem, net)
	case "taproot":
		internal, err := btcec.ParsePubKey(pubKey)
		if err != nil {
			return nil, err
		}
		output := txscript.ComputeTaprootKeyNoScript(internal)
		return btcutil.NewAddressTaproot(schnorr.SerializePubKey(output), net)
	default:
		return nil, fmt.Errorf("unsupported single-sig script type: %s", scriptType)
	}
}

func multisigAddress(pubKeys [][]byte, threshold int, scriptType string, net *chaincfg.Params) (btcutil.Address, error) {
	if threshold < 1 || threshold > len(pubKeys) || len(pubKeys) > 16 {
		return nil, fmt.Errorf("invalid multisig quorum")
	}
	sort.Slice(pubKeys, func(i, j int) bool { return bytes.Compare(pubKeys[i], pubKeys[j]) < 0 })
	builder := txscript.NewScriptBuilder().AddInt64(int64(threshold))
	for _, pubKey := range pubKeys {
		builder.AddData(pubKey)
	}
	witnessScript, err := builder.AddInt64(int64(len(pubKeys))).AddOp(txscript.OP_CHECKMULTISIG).Script()
	if err != nil {
		return nil, fmt.Errorf("build multisig witness script: %w", err)
	}
	witnessHash := sha256.Sum256(witnessScript)
	witness, err := btcutil.NewAddressWitnessScriptHash(witnessHash[:], net)
	if err != nil {
		return nil, err
	}
	if scriptType == "p2wsh" {
		return witness, nil
	}
	if scriptType == "p2sh_p2wsh" {
		redeem, err := txscript.PayToAddrScript(witness)
		if err != nil {
			return nil, err
		}
		return btcutil.NewAddressScriptHash(redeem, net)
	}
	return nil, fmt.Errorf("unsupported multisig script type: %s", scriptType)
}
