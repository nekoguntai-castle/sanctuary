.schemaVersion == 1
and .vendor.repository == "https://github.com/Blockstream/Jade"
and .vendor.release == "1.0.40"
and .vendor.sourceCommit == "6f858f39a19f89ff7fd4580c5b2db72cfe1dc0af"
and .vendor.sourceTarball == "https://github.com/Blockstream/Jade/archive/6f858f39a19f89ff7fd4580c5b2db72cfe1dc0af.tar.gz"
and .vendor.sourceTarballSha256 == "7699ab7f0101ec3d0980b002c65f2517bd6a0235eae34e48ea0b89d18d705481"
and .vendor.sourceFiles == {
  "Dockerfile.qemu": "18e22098de4386700fb002bed3c01c2bc57aa9ab375203ee4ebdab0bc82efc02",
  "jadepy/__init__.py": "31e9a0218118dd468ab4c2d572c0712c60595eaacf9be8274de6de9c4df9dc6a",
  "jadepy/jade.py": "ec5f26b5d46dac7f8d007789be0abbeaaec8f420ef8a816da5fa12949ad39145",
  "jadepy/jade_error.py": "68a216f856f87d017a6349e14d60230e03caf571da2ad5e45e83a35b451d02d3",
  "jadepy/jade_serial.py": "3b5dc8b6c506179324001e4ed467b7434cbf1b21be976393910946c4ead2be6d",
  "jadepy/jade_tcp.py": "b146f105e0bece631eb4ab50cc45876011933d3cbc1b571fe51dba604672e66c",
  "main/process/auth_user.c": "3e804c088289ca91eef4efcb29d3d676600f7e377616f0f07355a06d3963ec73",
  "main/process/pinclient.c": "bb4db10efef1f7780af718e179d6f0e62a7c51a40340ee3c6dceb885a560649b"
}
and .runtime.pythonVersion == "3.13.5"
and .runtime.image == "python:3.13.5-slim-bookworm@sha256:4c2cf9917bd1cbacc5e9b07320025bdb7cdf2df7b0ceaccb55e9dd7e30987419"
and .authBoundary.mode == "same-origin-fixed-relay"
and .authBoundary.applicationRoute == "/api/v1/hardware/jade/pin"
and .authBoundary.upstreamOrigin == "https://j8d.io"
and .authBoundary.operations == ["get_pin", "set_pin"]
and .authBoundary.method == "POST"
and .authBoundary.accept == "json"
and .authBoundary.onReply == "pin"
and .authBoundary.maxRequestBytes == 16384
and .authBoundary.maxResponseBytes == 16384
and .authBoundary.connectTimeoutMs == 5000
and .authBoundary.totalTimeoutMs == 15000
and .authBoundary.maxRedirects == 0
and .authBoundary.automaticRetries == 0
and .authBoundary.requiresApplicationAuth == true
and .authBoundary.requiresCsrf == true
and .authBoundary.logBodies == false
and .authBoundary.customPinserver == "blocked"
and .authBoundary.onion == "blocked"
and .authBoundary.offline == "blocked"
and .protocolLimits.maxFrameBytes == 1048576
and .protocolLimits.maxBufferedBytes == 2097152
and .protocolLimits.maxExtendedDataChunks == 256
and .protocolLimits.rpcTimeoutMs == 60000
and .protocolLimits.interactiveRpcTimeoutMs == 300000
and .implementationAcceptance == [
  "JADE-AUTH-001",
  "JADE-AUTH-002",
  "JADE-AUTH-003",
  "JADE-IDENTITY-001",
  "JADE-FRAMING-001",
  "JADE-PSBT-001",
  "JADE-PSBT-002",
  "JADE-FAILCLOSED-001",
  "JADE-IMPORT-001",
  "JADE-EVIDENCE-001",
  "JADE-MULTISIG-001"
]
