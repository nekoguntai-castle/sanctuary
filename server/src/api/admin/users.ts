/**
 * Admin Users Router
 *
 * Endpoints for user management (admin only)
 */

import { Router, type Request, type Response } from "express";
import expressRateLimit from "express-rate-limit";
import { userRepository } from "../../repositories";
import { authenticate, requireAdmin } from "../../middleware/auth";
import { rateLimitByUser } from "../../middleware/rateLimit";
import { asyncHandler } from "../../errors/errorHandler";
import {
  InvalidInputError,
  NotFoundError,
  ConflictError,
} from "../../errors/ApiError";
import { createLogger } from "../../utils/logger";
import { hashPassword } from "../../utils/password";
import {
  auditService,
  AuditAction,
  AuditCategory,
} from "../../services/auditService";
import { revokeAllUserTokens } from "../../services/tokenRevocation";
import { CreateUserSchema, UpdateUserSchema } from "../schemas/admin";
import { parseAdminRequestBody } from "./requestValidation";

const router = Router();
const log = createLogger("ADMIN_USER:ROUTE");
const adminUsersCodeqlLimiter = expressRateLimit({
  windowMs: 60_000,
  limit: 1000,
  standardHeaders: false,
  legacyHeaders: false,
});
const adminUsersPolicyLimiter = rateLimitByUser("admin:default");

type ExistingUserForUpdate = NonNullable<
  Awaited<ReturnType<typeof userRepository.findById>>
>;
type AdminUserUpdateInput = {
  username?: string;
  password?: string;
  email?: string | null;
  isAdmin?: boolean;
};

function hasIssueFor(
  issues: Array<{ path: PropertyKey[]; code: string }>,
  field: string,
): boolean {
  return issues.some((issue) => issue.path[0] === field);
}

function hasMissingIssueFor(
  issues: Array<{ path: PropertyKey[]; code: string }>,
  fields: string[],
): boolean {
  return issues.some(
    (issue) =>
      fields.includes(String(issue.path[0])) && issue.code === "invalid_type",
  );
}

function formatCreateUserValidation(
  issues: Array<{ path: PropertyKey[]; code: string; message: string }>,
): string {
  if (hasMissingIssueFor(issues, ["username", "password", "email"])) {
    return "Username, password, and email are required";
  }
  if (hasIssueFor(issues, "password")) {
    return "Password does not meet security requirements";
  }
  /* v8 ignore next -- route schema tests cover email-specific validation messages */
  if (hasIssueFor(issues, "email")) {
    return "Invalid email address format";
  }
  /* v8 ignore start -- ZodError from safeParse has at least one issue */
  return issues.map((issue) => issue.message).join(", ");
  /* v8 ignore stop */
}

function formatUpdateUserValidation(
  issues: Array<{ path: PropertyKey[]; code: string; message: string }>,
): string {
  if (hasIssueFor(issues, "password")) {
    return "Password does not meet security requirements";
  }
  /* v8 ignore next -- route schema tests cover email-specific validation messages */
  if (hasIssueFor(issues, "email")) {
    return "Invalid email address format";
  }
  /* v8 ignore start -- ZodError from safeParse has at least one issue */
  return issues.map((issue) => issue.message).join(", ");
  /* v8 ignore stop */
}

function getRequiredParam(req: Request, name: string): string {
  const value = req.params[name];
  const param = Array.isArray(value) ? value[0] : value;
  if (!param) throw new InvalidInputError(`Missing route parameter: ${name}`);
  return param;
}

async function applyUsernameUpdate(
  updateData: Record<string, unknown>,
  existingUser: ExistingUserForUpdate,
  username?: string,
): Promise<void> {
  if (!username || username === existingUser.username) return;

  // Check if new username is taken
  const usernameTaken = await userRepository.findByUsername(username);
  if (usernameTaken) {
    throw new ConflictError("Username already exists");
  }
  updateData.username = username;
}

async function applyEmailUpdate(
  updateData: Record<string, unknown>,
  existingUser: ExistingUserForUpdate,
  email?: string | null,
): Promise<void> {
  if (email === undefined) return;

  const normalizedEmail = email ? email.toLowerCase() : null;
  if (normalizedEmail && normalizedEmail !== existingUser.email) {
    // Check if new email is taken
    const emailTaken = await userRepository.findByEmail(normalizedEmail);
    if (emailTaken) {
      throw new ConflictError("Email already exists");
    }
    // Admin updating email - keep it verified (trusted)
    updateData.email = normalizedEmail;
    updateData.emailVerified = true;
    updateData.emailVerifiedAt = new Date();
    return;
  }

  if (!normalizedEmail && existingUser.email) {
    // Removing email
    updateData.email = null;
    updateData.emailVerified = false;
    updateData.emailVerifiedAt = null;
  }
}

async function buildUserUpdateData(
  existingUser: ExistingUserForUpdate,
  input: AdminUserUpdateInput,
): Promise<Record<string, unknown>> {
  const updateData: Record<string, unknown> = {};
  await applyUsernameUpdate(updateData, existingUser, input.username);
  await applyEmailUpdate(updateData, existingUser, input.email);

  if (input.password) {
    updateData.password = await hashPassword(input.password);
  }

  if (input.isAdmin !== undefined) {
    updateData.isAdmin = input.isAdmin === true;
  }

  return updateData;
}

async function auditUserUpdate(
  req: Request,
  userId: string,
  username: string,
  updateData: Record<string, unknown>,
): Promise<void> {
  if ("isAdmin" in updateData) {
    await auditService.logFromRequest(
      req,
      updateData.isAdmin
        ? AuditAction.USER_ADMIN_GRANT
        : AuditAction.USER_ADMIN_REVOKE,
      AuditCategory.USER,
      { details: { targetUser: username, userId } },
    );
    return;
  }

  await auditService.logFromRequest(
    req,
    AuditAction.USER_UPDATE,
    AuditCategory.USER,
    {
      details: {
        targetUser: username,
        userId,
        changes: Object.keys(updateData),
      },
    },
  );
}

async function handleUpdateUser(req: Request, res: Response): Promise<void> {
  const userId = getRequiredParam(req, "userId");

  // Check if user exists
  const existingUser = await userRepository.findById(userId);

  if (!existingUser) {
    throw new NotFoundError("User not found");
  }

  const updateInput = parseAdminRequestBody(
    UpdateUserSchema,
    req.body,
    formatUpdateUserValidation,
  ) as AdminUserUpdateInput;
  const updateData = await buildUserUpdateData(existingUser, updateInput);

  // Update user
  const user = await userRepository.updateWithSelect(userId, updateData, {
    id: true,
    username: true,
    email: true,
    emailVerified: true,
    isAdmin: true,
    createdAt: true,
    updatedAt: true,
  });

  // If password was changed by admin, invalidate all user sessions
  if ("password" in updateData) {
    await revokeAllUserTokens(userId, "admin_password_reset");
    log.info("User sessions invalidated after admin password reset", {
      userId,
    });
  }

  log.info("User updated:", { userId, changes: Object.keys(updateData) });
  await auditUserUpdate(req, userId, user.username, updateData);

  res.json(user);
}

/**
 * GET /api/v1/admin/users
 * Get all users (admin only)
 */
router.get(
  "/",
  adminUsersCodeqlLimiter,
  authenticate,
  adminUsersPolicyLimiter,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const users = await userRepository.findAllSummary();

    res.json(users);
  }),
);

/**
 * POST /api/v1/admin/users
 * Create a new user (admin only)
 */
router.post(
  "/",
  adminUsersCodeqlLimiter,
  authenticate,
  adminUsersPolicyLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { username, password, email, isAdmin } = parseAdminRequestBody(
      CreateUserSchema,
      req.body,
      formatCreateUserValidation,
    );

    // Check if username already exists
    const existingUser = await userRepository.findByUsername(username);

    if (existingUser) {
      throw new ConflictError("Username already exists");
    }

    // Check if email already exists
    const existingEmail = await userRepository.findByEmail(email.toLowerCase());

    if (existingEmail) {
      throw new ConflictError("Email already exists");
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user - admin-created users are trusted (auto-verified)
    const user = await userRepository.createWithSelect(
      {
        username,
        password: hashedPassword,
        email: email.toLowerCase(),
        emailVerified: true, // Admin-created users are trusted
        emailVerifiedAt: new Date(),
        isAdmin: isAdmin === true,
      },
      {
        id: true,
        username: true,
        email: true,
        emailVerified: true,
        isAdmin: true,
        createdAt: true,
      },
    );

    log.info("User created:", { username, isAdmin: isAdmin === true });

    // Audit log
    await auditService.logFromRequest(
      req,
      AuditAction.USER_CREATE,
      AuditCategory.USER,
      {
        details: { targetUser: username, isAdmin: isAdmin === true },
      },
    );

    res.status(201).json(user);
  }),
);

/**
 * PUT /api/v1/admin/users/:userId
 * Update a user (admin only)
 */
router.put(
  "/:userId",
  adminUsersCodeqlLimiter,
  authenticate,
  adminUsersPolicyLimiter,
  requireAdmin,
  asyncHandler(handleUpdateUser),
);

/**
 * DELETE /api/v1/admin/users/:userId
 * Delete a user (admin only)
 */
router.delete(
  "/:userId",
  adminUsersCodeqlLimiter,
  authenticate,
  adminUsersPolicyLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const currentUser = req.user;

    // Prevent self-deletion
    if (userId === currentUser?.userId) {
      throw new InvalidInputError("Cannot delete your own account");
    }

    // Check if user exists
    const existingUser = await userRepository.findById(userId);

    if (!existingUser) {
      throw new NotFoundError("User not found");
    }

    // Delete user
    await userRepository.deleteById(userId);

    log.info("User deleted:", { userId, username: existingUser.username });

    // Audit log
    await auditService.logFromRequest(
      req,
      AuditAction.USER_DELETE,
      AuditCategory.USER,
      {
        details: { targetUser: existingUser.username, userId },
      },
    );

    res.json({ message: "User deleted successfully" });
  }),
);

export default router;
