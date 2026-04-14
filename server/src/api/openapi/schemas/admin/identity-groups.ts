import { ADMIN_GROUP_ROLE_VALUES } from './shared';

export const adminIdentityGroupSchemas = {
  AdminUser: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      username: { type: 'string' },
      email: { type: 'string', format: 'email', nullable: true },
      emailVerified: { type: 'boolean' },
      emailVerifiedAt: { type: 'string', format: 'date-time', nullable: true },
      isAdmin: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'username', 'email', 'emailVerified', 'isAdmin', 'createdAt'],
  },
  AdminCreateUserRequest: {
    type: 'object',
    properties: {
      username: { type: 'string', minLength: 3 },
      password: {
        type: 'string',
        minLength: 8,
        description: 'Must include uppercase, lowercase, and numeric characters.',
      },
      email: { type: 'string', format: 'email' },
      isAdmin: { type: 'boolean', default: false },
    },
    required: ['username', 'password', 'email'],
    additionalProperties: false,
  },
  AdminUpdateUserRequest: {
    type: 'object',
    properties: {
      username: { type: 'string', minLength: 3 },
      password: {
        type: 'string',
        minLength: 8,
        description: 'Must include uppercase, lowercase, and numeric characters.',
      },
      email: {
        oneOf: [
          { type: 'string', format: 'email' },
          { type: 'string', enum: [''] },
        ],
        description: 'Use an empty string to clear the user email address.',
      },
      isAdmin: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  AdminDeleteUserResponse: {
    type: 'object',
    properties: {
      message: { type: 'string' },
    },
    required: ['message'],
  },
  AdminGroupRole: {
    type: 'string',
    enum: [...ADMIN_GROUP_ROLE_VALUES],
  },
  AdminGroupMember: {
    type: 'object',
    properties: {
      userId: { type: 'string' },
      username: { type: 'string' },
      role: { $ref: '#/components/schemas/AdminGroupRole' },
    },
    required: ['userId', 'username', 'role'],
  },
  AdminGroup: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      purpose: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      members: {
        type: 'array',
        items: { $ref: '#/components/schemas/AdminGroupMember' },
      },
    },
    required: ['id', 'name', 'description', 'purpose', 'createdAt', 'updatedAt', 'members'],
  },
  AdminCreateGroupRequest: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      description: { type: 'string', nullable: true },
      purpose: { type: 'string', nullable: true },
      memberIds: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  AdminUpdateGroupRequest: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      description: { type: 'string', nullable: true },
      purpose: { type: 'string', nullable: true },
      memberIds: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    additionalProperties: false,
  },
  AdminAddGroupMemberRequest: {
    type: 'object',
    properties: {
      userId: { type: 'string' },
      role: { $ref: '#/components/schemas/AdminGroupRole' },
    },
    required: ['userId'],
    additionalProperties: false,
  },
  AdminDeleteGroupResponse: {
    type: 'object',
    properties: {
      message: { type: 'string' },
    },
    required: ['message'],
  },
  AdminRemoveGroupMemberResponse: {
    type: 'object',
    properties: {
      message: { type: 'string' },
    },
    required: ['message'],
  },
  AdminPolicyDeleteResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
    },
    required: ['success'],
  },
} as const;
