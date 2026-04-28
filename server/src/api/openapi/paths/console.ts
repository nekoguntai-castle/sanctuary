const auth = [{ bearerAuth: [] }, { cookieAuth: [] }];

const standardErrors = {
  "400": { description: "Invalid console request" },
  "401": { description: "Authentication required" },
  "403": { description: "Console feature disabled or access denied" },
  "404": { description: "Console resource not found" },
  "503": { description: "AI provider or proxy unavailable" },
};

const successResponse = {
  description: "Operation succeeded",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
        },
        required: ["success"],
      },
    },
  },
};

const promptClearResponse = {
  description: "Prompt history cleared",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          deleted: { type: "integer", minimum: 0 },
        },
        required: ["success", "deleted"],
      },
    },
  },
};

export const consolePaths = {
  "/console/tools": {
    get: {
      tags: ["Console"],
      summary: "List read-only Sanctuary Console tools",
      security: auth,
      responses: {
        "200": {
          description: "Available console tools",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  tools: {
                    type: "array",
                    items: { $ref: "#/components/schemas/ConsoleTool" },
                  },
                },
                required: ["tools"],
              },
            },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/console/sessions": {
    get: {
      tags: ["Console"],
      summary: "List Console sessions for the authenticated user",
      security: auth,
      responses: {
        "200": {
          description: "Console sessions",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  sessions: {
                    type: "array",
                    items: { $ref: "#/components/schemas/ConsoleSession" },
                  },
                },
                required: ["sessions"],
              },
            },
          },
        },
        ...standardErrors,
      },
    },
    post: {
      tags: ["Console"],
      summary: "Create a scoped Console session",
      security: auth,
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                scope: { $ref: "#/components/schemas/ConsoleScope" },
                maxSensitivity: {
                  type: "string",
                  enum: ["public", "wallet", "high", "admin"],
                },
                expiresAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Created Console session",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  session: { $ref: "#/components/schemas/ConsoleSession" },
                },
                required: ["session"],
              },
            },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/console/sessions/{id}/turns": {
    get: {
      tags: ["Console"],
      summary: "List turns for a Console session",
      security: auth,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        "200": {
          description: "Console turns",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  turns: {
                    type: "array",
                    items: { $ref: "#/components/schemas/ConsoleTurn" },
                  },
                },
                required: ["turns"],
              },
            },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/console/sessions/{id}": {
    delete: {
      tags: ["Console"],
      summary: "Delete one Console session",
      security: auth,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        "200": successResponse,
        ...standardErrors,
      },
    },
  },
  "/console/turns": {
    post: {
      tags: ["Console"],
      summary:
        "Run a Console turn with model planning and backend tool execution",
      security: auth,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                sessionId: { type: "string", format: "uuid" },
                prompt: { type: "string" },
                scope: { $ref: "#/components/schemas/ConsoleScope" },
                maxSensitivity: {
                  type: "string",
                  enum: ["public", "wallet", "high", "admin"],
                },
                expiresAt: { type: "string", format: "date-time" },
              },
              required: ["prompt"],
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Completed Console turn",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  session: { $ref: "#/components/schemas/ConsoleSession" },
                  turn: { $ref: "#/components/schemas/ConsoleTurn" },
                  promptHistory: {
                    $ref: "#/components/schemas/ConsolePromptHistory",
                  },
                  toolTraces: {
                    type: "array",
                    items: { $ref: "#/components/schemas/ConsoleToolTrace" },
                  },
                },
                required: ["session", "turn", "promptHistory", "toolTraces"],
              },
            },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/console/prompts": {
    get: {
      tags: ["Console"],
      summary: "Search Console prompt history",
      security: auth,
      parameters: [
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 100, default: 30 },
        },
        {
          name: "offset",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 0, default: 0 },
        },
        {
          name: "search",
          in: "query",
          required: false,
          schema: { type: "string", maxLength: 300 },
        },
        {
          name: "saved",
          in: "query",
          required: false,
          schema: { type: "boolean" },
        },
        {
          name: "includeExpired",
          in: "query",
          required: false,
          schema: { type: "boolean", default: false },
        },
      ],
      responses: {
        "200": {
          description: "Prompt history",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  prompts: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/ConsolePromptHistory",
                    },
                  },
                },
                required: ["prompts"],
              },
            },
          },
        },
        ...standardErrors,
      },
    },
    delete: {
      tags: ["Console"],
      summary: "Clear Console prompt history",
      security: auth,
      responses: {
        "200": promptClearResponse,
        ...standardErrors,
      },
    },
  },
  "/console/prompts/{id}": {
    patch: {
      tags: ["Console"],
      summary: "Save, unsave, title, or expire a Console prompt",
      security: auth,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                saved: { type: "boolean" },
                title: { type: "string", nullable: true },
                expiresAt: {
                  type: "string",
                  format: "date-time",
                  nullable: true,
                },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Updated prompt history entry",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  prompt: { $ref: "#/components/schemas/ConsolePromptHistory" },
                },
                required: ["prompt"],
              },
            },
          },
        },
        ...standardErrors,
      },
    },
    delete: {
      tags: ["Console"],
      summary: "Delete one Console prompt-history entry",
      security: auth,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        "200": { description: "Prompt deleted" },
        ...standardErrors,
      },
    },
  },
  "/console/prompts/{id}/replay": {
    post: {
      tags: ["Console"],
      summary: "Replay a stored prompt against current permissions and data",
      security: auth,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                sessionId: { type: "string", format: "uuid" },
                scope: { $ref: "#/components/schemas/ConsoleScope" },
                maxSensitivity: {
                  type: "string",
                  enum: ["public", "wallet", "high", "admin"],
                },
                expiresAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Replay turn result",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  session: { $ref: "#/components/schemas/ConsoleSession" },
                  turn: { $ref: "#/components/schemas/ConsoleTurn" },
                  promptHistory: {
                    $ref: "#/components/schemas/ConsolePromptHistory",
                  },
                  toolTraces: {
                    type: "array",
                    items: { $ref: "#/components/schemas/ConsoleToolTrace" },
                  },
                },
                required: ["session", "turn", "promptHistory", "toolTraces"],
              },
            },
          },
        },
        ...standardErrors,
      },
    },
  },
} as const;
