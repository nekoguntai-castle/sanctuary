// Package main provides address derivation verification using btcd/btcutil
//
// This is an independent Go implementation for cross-verification.
// Uses the btcsuite libraries which power many Bitcoin applications including LND.
//
// Usage:
//
//	go run go-verify.go single <xpub> <index> <script_type> <change> <network>
//	go run go-verify.go multi <xpubs_json> <threshold> <index> <script_type> <change> <network>
//	go run go-verify.go check
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/btcutil/base58"
	"github.com/btcsuite/btcd/btcutil/hdkeychain"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/txscript"
	"golang.org/x/crypto/ripemd160"
)

const maxChildIndex = uint64(4294967295)

type Result struct {
	Address   string `json:"address,omitempty"`
	Error     string `json:"error,omitempty"`
	Available bool   `json:"available,omitempty"`
	Version   string `json:"version,omitempty"`
	Name      string `json:"name,omitempty"`
}

func main() {
	if len(os.Args) < 2 {
		outputError("Usage: go-verify.go <command> <args>")
		return
	}

	command := os.Args[1]

	switch command {
	case "check":
		outputJSON(Result{
			Available: true,
			Version:   "0.24.2",
			Name:      "btcd/btcutil",
		})

	case "single":
		if len(os.Args) != 7 {
			outputError("Usage: single <xpub> <index> <script_type> <change> <network>")
			return
		}
		xpub := os.Args[2]
		index, err := parseUint32Arg("index", os.Args[3])
		if err != nil {
			outputError(err.Error())
			return
		}
		scriptType := os.Args[4]
		change := os.Args[5] == "true"
		network := os.Args[6]

		address, err := deriveSingleSig(xpub, index, scriptType, change, network)
		if err != nil {
			outputError(err.Error())
			return
		}
		outputJSON(Result{Address: address})

	case "multi":
		if len(os.Args) != 8 {
			outputError("Usage: multi <xpubs_json> <threshold> <index> <script_type> <change> <network>")
			return
		}
		var xpubs []string
		if err := json.Unmarshal([]byte(os.Args[2]), &xpubs); err != nil {
			outputError("Failed to parse xpubs: " + err.Error())
			return
		}
		threshold, err := parsePositiveIntArg("threshold", os.Args[3])
		if err != nil {
			outputError(err.Error())
			return
		}
		index, err := parseUint32Arg("index", os.Args[4])
		if err != nil {
			outputError(err.Error())
			return
		}
		scriptType := os.Args[5]
		change := os.Args[6] == "true"
		network := os.Args[7]

		address, err := deriveMultisig(xpubs, threshold, index, scriptType, change, network)
		if err != nil {
			outputError(err.Error())
			return
		}
		outputJSON(Result{Address: address})

	default:
		outputError("Unknown command: " + command)
	}
}

func parseUint32Arg(name string, value string) (uint32, error) {
	parsed, err := strconv.ParseUint(value, 10, 32)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: must be an integer between 0 and %d", name, maxChildIndex)
	}
	return uint32(parsed), nil
}

func parsePositiveIntArg(name string, value string) (int, error) {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 1 {
		return 0, fmt.Errorf("invalid %s: must be a positive integer", name)
	}
	return parsed, nil
}

func outputJSON(r Result) {
	json.NewEncoder(os.Stdout).Encode(r)
}

func outputError(msg string) {
	outputJSON(Result{Error: msg})
}

func getNetwork(network string) *chaincfg.Params {
	if network == "mainnet" {
		return &chaincfg.MainNetParams
	}
	return &chaincfg.TestNet3Params
}

// convertToStandardXpub converts zpub/ypub etc to xpub/tpub format
func convertToStandardXpub(xpub string, network string) string {
	prefix := xpub[:4]

	// Already standard format
	if prefix == "xpub" || prefix == "tpub" {
		return xpub
	}

	// Decode the xpub
	decoded := base58.Decode(xpub)
	if len(decoded) < 78 {
		return xpub // Invalid, return as-is
	}

	// Replace version bytes
	var newVersion []byte
	if network == "mainnet" {
		newVersion = []byte{0x04, 0x88, 0xB2, 0x1E} // xpub
	} else {
		newVersion = []byte{0x04, 0x35, 0x87, 0xCF} // tpub
	}

	// Create new key with standard version
	newKey := append(newVersion, decoded[4:]...)

	return base58.CheckEncode(newKey[:len(newKey)-4], 0)
}

func deriveSingleSig(xpub string, index uint32, scriptType string, change bool, network string) (string, error) {
	net := getNetwork(network)
	pubKeyBytes, err := deriveSingleSigPubKeyBytes(xpub, index, change, network)
	if err != nil {
		return "", err
	}
	return encodeSingleSigAddress(pubKeyBytes, scriptType, net)
}

func deriveSingleSigPubKeyBytes(xpub string, index uint32, change bool, network string) ([]byte, error) {
	// Convert to standard format
	standardXpub := convertToStandardXpub(xpub, network)

	// Parse extended key
	extKey, err := hdkeychain.NewKeyFromString(standardXpub)
	if err != nil {
		return nil, fmt.Errorf("failed to parse xpub: %v", err)
	}

	// Derive: change / index
	changeIdx := uint32(0)
	if change {
		changeIdx = 1
	}

	childKey, err := extKey.Derive(changeIdx)
	if err != nil {
		return nil, fmt.Errorf("failed to derive change: %v", err)
	}

	derivedKey, err := childKey.Derive(index)
	if err != nil {
		return nil, fmt.Errorf("failed to derive index: %v", err)
	}

	pubKey, err := derivedKey.ECPubKey()
	if err != nil {
		return nil, fmt.Errorf("failed to get public key: %v", err)
	}

	return pubKey.SerializeCompressed(), nil
}

func encodeSingleSigAddress(pubKeyBytes []byte, scriptType string, net *chaincfg.Params) (string, error) {
	switch scriptType {
	case "legacy":
		return encodeLegacyAddress(pubKeyBytes, net)

	case "nested_segwit":
		return encodeNestedSegwitAddress(pubKeyBytes, net)

	case "native_segwit":
		return encodeNativeSegwitAddress(pubKeyBytes, net)

	case "taproot":
		return encodeTaprootAddress(pubKeyBytes, net)

	default:
		return "", fmt.Errorf("unknown script type: %s", scriptType)
	}
}

func encodeLegacyAddress(pubKeyBytes []byte, net *chaincfg.Params) (string, error) {
	pubKeyHash := btcutil.Hash160(pubKeyBytes)
	addr, err := btcutil.NewAddressPubKeyHash(pubKeyHash, net)
	if err != nil {
		return "", err
	}
	return addr.EncodeAddress(), nil
}

func encodeNestedSegwitAddress(pubKeyBytes []byte, net *chaincfg.Params) (string, error) {
	pubKeyHash := btcutil.Hash160(pubKeyBytes)
	witAddr, err := btcutil.NewAddressWitnessPubKeyHash(pubKeyHash, net)
	if err != nil {
		return "", err
	}
	script, err := txscript.PayToAddrScript(witAddr)
	if err != nil {
		return "", err
	}
	scriptHash := btcutil.Hash160(script)
	addr, err := btcutil.NewAddressScriptHashFromHash(scriptHash, net)
	if err != nil {
		return "", err
	}
	return addr.EncodeAddress(), nil
}

func encodeNativeSegwitAddress(pubKeyBytes []byte, net *chaincfg.Params) (string, error) {
	pubKeyHash := btcutil.Hash160(pubKeyBytes)
	addr, err := btcutil.NewAddressWitnessPubKeyHash(pubKeyHash, net)
	if err != nil {
		return "", err
	}
	return addr.EncodeAddress(), nil
}

func encodeTaprootAddress(pubKeyBytes []byte, net *chaincfg.Params) (string, error) {
	xOnlyPubKey := pubKeyBytes[1:33] // Remove prefix byte
	addr, err := btcutil.NewAddressTaproot(xOnlyPubKey, net)
	if err != nil {
		return "", err
	}
	return addr.EncodeAddress(), nil
}

func deriveMultisig(xpubs []string, threshold int, index uint32, scriptType string, change bool, network string) (string, error) {
	net := getNetwork(network)

	changeIdx := uint32(0)
	if change {
		changeIdx = 1
	}

	// Derive public keys from each xpub
	var pubKeys []*btcec.PublicKey
	for _, xpub := range xpubs {
		standardXpub := convertToStandardXpub(xpub, network)
		extKey, err := hdkeychain.NewKeyFromString(standardXpub)
		if err != nil {
			return "", fmt.Errorf("failed to parse xpub: %v", err)
		}

		childKey, err := extKey.Derive(changeIdx)
		if err != nil {
			return "", fmt.Errorf("failed to derive change: %v", err)
		}

		derivedKey, err := childKey.Derive(index)
		if err != nil {
			return "", fmt.Errorf("failed to derive index: %v", err)
		}

		pubKey, err := derivedKey.ECPubKey()
		if err != nil {
			return "", fmt.Errorf("failed to get public key: %v", err)
		}

		pubKeys = append(pubKeys, pubKey)
	}

	// Sort public keys (BIP-67)
	sort.Slice(pubKeys, func(i, j int) bool {
		return bytes.Compare(
			pubKeys[i].SerializeCompressed(),
			pubKeys[j].SerializeCompressed(),
		) < 0
	})

	// Build multisig script
	builder := txscript.NewScriptBuilder()
	builder.AddInt64(int64(threshold))
	for _, pk := range pubKeys {
		builder.AddData(pk.SerializeCompressed())
	}
	builder.AddInt64(int64(len(pubKeys)))
	builder.AddOp(txscript.OP_CHECKMULTISIG)

	redeemScript, err := builder.Script()
	if err != nil {
		return "", fmt.Errorf("failed to build redeem script: %v", err)
	}

	switch scriptType {
	case "p2sh":
		// P2SH
		scriptHash := btcutil.Hash160(redeemScript)
		addr, err := btcutil.NewAddressScriptHashFromHash(scriptHash, net)
		if err != nil {
			return "", err
		}
		return addr.EncodeAddress(), nil

	case "p2wsh":
		// P2WSH
		witnessHash := sha256.Sum256(redeemScript)
		addr, err := btcutil.NewAddressWitnessScriptHash(witnessHash[:], net)
		if err != nil {
			return "", err
		}
		return addr.EncodeAddress(), nil

	case "p2sh_p2wsh":
		// P2SH-P2WSH
		// First create P2WSH
		witnessHash := sha256.Sum256(redeemScript)

		// Create witness program: OP_0 <32-byte-hash>
		witnessProgram := make([]byte, 34)
		witnessProgram[0] = 0x00
		witnessProgram[1] = 0x20
		copy(witnessProgram[2:], witnessHash[:])

		// Hash160 of witness program
		h := sha256.Sum256(witnessProgram)
		ripemd := ripemd160.New()
		ripemd.Write(h[:])
		scriptHash := ripemd.Sum(nil)

		addr, err := btcutil.NewAddressScriptHashFromHash(scriptHash, net)
		if err != nil {
			return "", err
		}
		return addr.EncodeAddress(), nil

	default:
		return "", fmt.Errorf("unknown multisig script type: %s", scriptType)
	}
}

// Helper to convert hex string to bytes (for debugging)
func hexToBytes(s string) []byte {
	b, _ := hex.DecodeString(s)
	return b
}
