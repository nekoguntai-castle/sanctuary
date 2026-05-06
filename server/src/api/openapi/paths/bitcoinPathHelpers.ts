import { browserOrBearerAuth as bearerAuth } from "../security";

export { bearerAuth };

export const apiErrorResponse = {
  description: "Error response",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ApiError" },
    },
  },
} as const;

export const jsonRequestBody = (schemaRef: string) => ({
  required: true,
  content: {
    "application/json": {
      schema: { $ref: schemaRef },
    },
  },
});

export const optionalJsonRequestBody = (schemaRef: string) => ({
  required: false,
  content: {
    "application/json": {
      schema: { $ref: schemaRef },
    },
  },
});

export const jsonResponse = (description: string, schemaRef: string) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: schemaRef },
    },
  },
});

export const currencyQueryParameter = {
  name: "currency",
  in: "query",
  required: false,
  schema: { type: "string", default: "USD" },
} as const;

export const priceProviderParameter = {
  name: "provider",
  in: "path",
  required: true,
  schema: { type: "string" },
} as const;

export const walletIdParameter = {
  name: "walletId",
  in: "path",
  required: true,
  schema: { type: "string" },
} as const;

export const syncNetworkParameter = {
  name: "network",
  in: "path",
  required: true,
  schema: { type: "string", enum: ["mainnet", "testnet3", "testnet4", "signet"] },
} as const;

export const txidParameter = {
  name: "txid",
  in: "path",
  required: true,
  schema: { type: "string" },
} as const;

export const addressNetworkQueryParameter = {
  name: "network",
  in: "query",
  required: false,
  schema: {
    type: "string",
    enum: ["mainnet", "testnet3", "testnet4", "signet", "regtest"],
    default: "mainnet",
  },
} as const;
