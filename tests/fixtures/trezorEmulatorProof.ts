export const TREZOR_EMULATOR_PROOF_CONTRACT = {
  image:
    'ghcr.io/trezor/trezor-user-env@sha256:de72f49d7db85f27d51c9f7a516363a701a0c4b5e554efa632ac89fe776f8db6',
  model: 'T2T1',
  firmware: '2.12.2',
  bridge: '2.0.33',
  connect: '9.7.3',
} as const;

export const EXPECTED_TREZOR_EMULATOR_PROOF = {
  fingerprint: '5c9e228d',
  bip49Account0Xpub:
    'tpubDCHRnuvE95JrpEVTUmr36sK3K9ADf3s3aztpXzL8coBeCTE8cHV8PjxS6SjWJM3GfPn798gyEa3dRPgjoUDSuNfuC9xz4PHznwKEk2XL7X1',
  bip84Account0Xpub:
    'tpubDCZB6sR48s4T5Cr8qHUYSZEFCQMMHRg8AoVKVmvcAP5bRw7ArDKeoNwKAJujV3xCPkBvXH5ejSgbgyN6kREmF7sMd41NdbuHa8n1DZNxSMg',
  bip84Account1Xpub:
    'tpubDCZB6sR48s4T6xoXqaYxScvf23kmQvg5QpyFkYnDBjsmviKHLSG9s6cp593Exg87tuMjXXMWDvBRXnJtzppcQf8Z8HdJP1rothfxm4qnPXo',
  bip49Receive0: '2N4Q5FhU2497BryFfUgbqkAJE87aKHUhXMp',
  bip84Receive0: 'tb1qkvwu9g3k2pdxewfqr7syz89r3gj557l3uuf9r9',
  bip84Change0: 'tb1qejqxwzfld7zr6mf7ygqy5s5se5xq7vmt96jk9x',
  bip84Receive19: 'tb1qpcgw9fuec7wjjnq8rl0cwfwa7mqvrheu0rv2jx',
  bip84Account1Receive0: 'tb1q7r9yvcdgcl6wmtta58yxf29a8kc96jkyxl7y88',
  bip86Account0Xpub:
    'tpubDC88gkaZi5HvJGxGDNLADkvtdpni3mLmx6vr2KnXmWMG8zfkBRggsxHVBkUpgcwPe2KKpkyvTJCdXHb1UHEWE64vczyyPQfHr1skBcsRedN',
  bip86Receive0: 'tb1pswrqtykue8r89t9u4rprjs0gt4qzkdfuursfnvqaa3f2yql07zmq8s8a5u',
  bip48NestedAccount0Xpub:
    'tpubDEGquuorgFNbAruGTh2snvYLhtdMpMd9xeYU7vGscQsxMwtB5TiTyjBmkDQZDtUJECP1U8TbgKPqBK8RuCYzVXuA3uRxkRbkn3THWtGgVu2',
  bip48NativeAccount0Xpub:
    'tpubDEGquuorgFNbDrg8vepq1HnaV2mgQu9TcSBgBYfXw4AX8VMgkWqvkxHNuJmiah8iVnA3Hgj4cSvaGAXEnq814yC6hMEreckLsd7zyLL3o76',
  bip48NestedReceive0: '2N4cuZkA2WQGVGWeMPnZtnxn7szdMmXTeB9',
} as const;
