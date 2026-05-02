UPDATE "node_configs"
SET
  "testnetMode" = COALESCE("testnetMode", 'singleton'),
  "testnetSingletonHost" = COALESCE("testnetSingletonHost", 'electrum.blockstream.info'),
  "testnetSingletonPort" = COALESCE("testnetSingletonPort", 60002),
  "testnetSingletonSsl" = COALESCE("testnetSingletonSsl", true),
  "testnetPoolMin" = COALESCE("testnetPoolMin", 1),
  "testnetPoolMax" = COALESCE("testnetPoolMax", 3),
  "testnetPoolLoadBalancing" = COALESCE("testnetPoolLoadBalancing", 'round_robin')
WHERE "isDefault" = true
  AND COALESCE("testnetEnabled", false) = false
  AND "testnetSingletonHost" IS NULL
  AND "testnetSingletonPort" IS NULL;

UPDATE "node_configs"
SET
  "signetMode" = COALESCE("signetMode", 'singleton'),
  "signetSingletonHost" = COALESCE("signetSingletonHost", 'electrum.mutinynet.com'),
  "signetSingletonPort" = COALESCE("signetSingletonPort", 50002),
  "signetSingletonSsl" = COALESCE("signetSingletonSsl", true),
  "signetPoolMin" = COALESCE("signetPoolMin", 1),
  "signetPoolMax" = COALESCE("signetPoolMax", 3),
  "signetPoolLoadBalancing" = COALESCE("signetPoolLoadBalancing", 'round_robin')
WHERE "isDefault" = true
  AND COALESCE("signetEnabled", false) = false
  AND "signetSingletonHost" IS NULL
  AND "signetSingletonPort" IS NULL;
