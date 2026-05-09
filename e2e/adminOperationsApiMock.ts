import type { Page, Route } from "@playwright/test";
import { AGENT_WALLET_DASHBOARD_ROWS } from "./adminOperationsFixtures";
import {
  createAdminApiState,
  mockResponse,
  STATIC_ADMIN_API_RESPONSES,
  type AdminApiState,
  type AdminOpsGroup,
  type AdminOpsUser,
  type MockApiFailure,
  type MockApiResponse,
} from "./adminOperationsApiState";
import { json, registerApiRoutes, unmocked } from "./helpers";

type AgentDashboardRow = (typeof AGENT_WALLET_DASHBOARD_ROWS)[number];

type ParsedApiRoute = {
  method: string;
  path: string;
  requestKey: string;
};

type AdminApiResponder = (
  route: Route,
  parsedRoute: ParsedApiRoute,
  state: AdminApiState,
) => MockApiResponse | null;

function parseApiRoute(route: Route): ParsedApiRoute {
  const request = route.request();
  const method = request.method();
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api\/v1/, "");
  return { method, path, requestKey: `${method} ${path}` };
}

async function maybeFulfillFailure(
  route: Route,
  failure?: MockApiFailure,
): Promise<boolean> {
  if (!failure) {
    return false;
  }

  await json(
    route,
    failure.body ?? { message: "Injected failure" },
    failure.status ?? 500,
  );
  return true;
}

function finalPathSegment(path: string) {
  return path.split("/").pop();
}

const cloneAgentDashboardRows = (
  rows: AgentDashboardRow[],
): AgentDashboardRow[] => structuredClone(rows);

const getRegistrationStatusResponse: AdminApiResponder = (
  _route,
  { requestKey },
  state,
) => {
  return requestKey === "GET /auth/registration-status"
    ? mockResponse({ enabled: state.settingsState.registrationEnabled })
    : null;
};

const getFeatureResponse: AdminApiResponder = (
  route,
  { method, path, requestKey },
  state,
) => {
  if (requestKey === "GET /admin/features") {
    return mockResponse(state.flagState);
  }
  if (method === "PUT" && /^\/admin\/features\//.test(path)) {
    const flagKey = finalPathSegment(path);
    const body = route.request().postDataJSON() as { enabled: boolean };
    state.flagState = state.flagState.map((f) =>
      f.key === flagKey
        ? {
            ...f,
            enabled: body.enabled,
            modifiedBy: "admin",
            updatedAt: new Date().toISOString(),
          }
        : f,
    );
    const updated = state.flagState.find((f) => f.key === flagKey);
    return mockResponse(
      updated ?? { message: "Flag not found" },
      updated ? 200 : 404,
    );
  }
  return null;
};

const getUserResponse: AdminApiResponder = (
  route,
  { method, path, requestKey },
  state,
) => {
  if (requestKey === "GET /admin/users") {
    return mockResponse(state.usersState);
  }
  if (requestKey === "POST /admin/users") {
    const body = route.request().postDataJSON() as Partial<AdminOpsUser>;
    const newUser = {
      id: `user-new-${Date.now()}`,
      username: body.username ?? "",
      email: body.email ?? null,
      isAdmin: body.isAdmin ?? false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.usersState = [...state.usersState, newUser];
    return mockResponse(newUser, 201);
  }
  if (method === "PUT" && /^\/admin\/users\//.test(path)) {
    const userId = finalPathSegment(path);
    const body = route.request().postDataJSON() as Partial<AdminOpsUser>;
    state.usersState = state.usersState.map((u) =>
      u.id === userId
        ? { ...u, ...body, updatedAt: new Date().toISOString() }
        : u,
    );
    return mockResponse(state.usersState.find((u) => u.id === userId));
  }
  if (method === "DELETE" && /^\/admin\/users\//.test(path)) {
    const userId = finalPathSegment(path);
    state.usersState = state.usersState.filter((u) => u.id !== userId);
    return mockResponse({ message: "User deleted" });
  }
  return null;
};

const getGroupResponse: AdminApiResponder = (
  route,
  { method, path, requestKey },
  state,
) => {
  if (requestKey === "GET /admin/groups") {
    return mockResponse(state.groupsState);
  }
  if (requestKey === "POST /admin/groups") {
    const body = route.request().postDataJSON() as Pick<AdminOpsGroup, "name">;
    const newGroup = {
      id: `group-new-${Date.now()}`,
      name: body.name,
      members: [],
    };
    state.groupsState = [...state.groupsState, newGroup];
    return mockResponse(newGroup, 201);
  }
  if (method === "PUT" && /^\/admin\/groups\//.test(path)) {
    const groupId = finalPathSegment(path);
    const body = route.request().postDataJSON() as Partial<AdminOpsGroup>;
    state.groupsState = state.groupsState.map((g) =>
      g.id === groupId ? { ...g, ...body } : g,
    );
    return mockResponse(state.groupsState.find((g) => g.id === groupId));
  }
  if (method === "DELETE" && /^\/admin\/groups\//.test(path)) {
    const groupId = finalPathSegment(path);
    state.groupsState = state.groupsState.filter((g) => g.id !== groupId);
    return mockResponse({ message: "Group deleted" });
  }
  return null;
};

const getSettingsResponse: AdminApiResponder = (
  route,
  { requestKey },
  state,
) => {
  if (requestKey === "GET /admin/settings") {
    return mockResponse(state.settingsState);
  }
  if (requestKey === "PUT /admin/settings") {
    const body = route.request().postDataJSON() as Partial<
      AdminApiState["settingsState"]
    >;
    state.settingsState = { ...state.settingsState, ...body };
    return mockResponse(state.settingsState);
  }
  return null;
};

const getNodeConfigResponse: AdminApiResponder = (
  route,
  { requestKey },
  state,
) => {
  if (requestKey === "GET /admin/node-config") {
    return mockResponse(state.nodeConfigState);
  }
  if (requestKey === "PUT /admin/node-config") {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.nodeConfigState = { ...state.nodeConfigState, ...body };
    return mockResponse(state.nodeConfigState);
  }
  return null;
};

const getBackupResponse: AdminApiResponder = (
  _route,
  { requestKey },
  _state,
) => {
  if (requestKey === "POST /admin/backup") {
    return mockResponse({
      data: { users: [], wallets: [], devices: [] },
      metadata: {
        version: "0.8.14",
        createdAt: new Date().toISOString(),
        createdBy: "admin",
        description: "E2E test backup",
      },
    });
  }
  if (requestKey === "POST /admin/encryption-keys") {
    return mockResponse({
      encryptionKey: "test-key",
      encryptionSalt: "test-salt",
      hasEncryptionKey: true,
      hasEncryptionSalt: true,
    });
  }
  return null;
};

const ADMIN_API_RESPONDERS: AdminApiResponder[] = [
  getRegistrationStatusResponse,
  getFeatureResponse,
  getUserResponse,
  getGroupResponse,
  getSettingsResponse,
  getNodeConfigResponse,
  getBackupResponse,
];

function getAdminApiResponse(
  route: Route,
  parsedRoute: ParsedApiRoute,
  state: AdminApiState,
): MockApiResponse | null {
  for (const responder of ADMIN_API_RESPONDERS) {
    const response = responder(route, parsedRoute, state);
    if (response) {
      return response;
    }
  }
  return STATIC_ADMIN_API_RESPONSES[parsedRoute.requestKey] ?? null;
}

function createAdminApiRouteHandler(options: {
  failures?: Record<string, MockApiFailure>;
  responseOverrides?: Record<string, MockApiResponse>;
  agentDashboardRows?: AgentDashboardRow[];
  unhandledRequests: string[];
}) {
  const state = createAdminApiState();
  let agentDashboardRows = options.agentDashboardRows
    ? cloneAgentDashboardRows(options.agentDashboardRows)
    : null;
  const apiRouteHandler = async (route: Route) => {
    const parsedRoute = parseApiRoute(route);
    const { method, path, requestKey } = parsedRoute;

    if (await maybeFulfillFailure(route, options.failures?.[requestKey])) {
      return;
    }

    if (agentDashboardRows && requestKey === "GET /admin/agents/dashboard") {
      await json(route, agentDashboardRows);
      return;
    }

    if (
      agentDashboardRows &&
      method === "PATCH" &&
      /^\/admin\/agents\/[^/]+$/.test(path)
    ) {
      const agentId = finalPathSegment(path);
      const body = route.request().postDataJSON() as { status?: string };
      let updatedAgent: AgentDashboardRow["agent"] | undefined;

      agentDashboardRows = agentDashboardRows.map((row) => {
        if (row.agent.id !== agentId) {
          return row;
        }

        updatedAgent = {
          ...row.agent,
          ...(body.status ? { status: body.status } : {}),
          updatedAt: new Date().toISOString(),
        };
        return { ...row, agent: updatedAgent };
      });

      await json(
        route,
        updatedAgent ?? { message: "Agent not found" },
        updatedAgent ? 200 : 404,
      );
      return;
    }

    const override = options.responseOverrides?.[requestKey];
    if (override) {
      await json(route, override.body, override.status);
      return;
    }

    const response = getAdminApiResponse(route, parsedRoute, state);
    if (response) {
      await json(route, response.body, response.status);
      return;
    }

    options.unhandledRequests.push(requestKey);
    await unmocked(route, method, path);
  };

  return apiRouteHandler;
}

export async function mockAdminApi(
  page: Page,
  options?: {
    failures?: Record<string, MockApiFailure>;
    responseOverrides?: Record<string, MockApiResponse>;
    agentDashboardRows?: AgentDashboardRow[];
  },
) {
  await page.addInitScript(() => {
    localStorage.setItem("sanctuary_token", "playwright-admin-ops-token");
  });

  const unhandledRequests: string[] = [];
  await registerApiRoutes(
    page,
    createAdminApiRouteHandler({
      failures: options?.failures,
      responseOverrides: options?.responseOverrides,
      agentDashboardRows: options?.agentDashboardRows,
      unhandledRequests,
    }),
  );
  return unhandledRequests;
}
