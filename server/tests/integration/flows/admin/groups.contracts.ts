import { describe, expect, it } from 'vitest';
import {
  app,
  authHeader,
  createAdminAndLogin,
  createUserAndLogin,
  prisma,
  request,
} from './adminIntegrationTestHarness';

export function registerAdminGroupManagementContracts(): void {
  // =============================================
  // GROUP MANAGEMENT
  // =============================================

  describe('Group Management', () => {
    describe('GET /api/v1/admin/groups', () => {
      it('should return all groups for admin', async () => {
        const { token } = await createAdminAndLogin();

        // Create test groups
        await prisma.group.createMany({
          data: [
            { name: 'Group A', description: 'First group' },
            { name: 'Group B', description: 'Second group' },
          ],
        });

        const response = await request(app)
          .get('/api/v1/admin/groups')
          .set(authHeader(token))
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThanOrEqual(2);
        expect(response.body[0]).toHaveProperty('name');
        expect(response.body[0]).toHaveProperty('members');

        // Verify our test groups are in the response
        const groupNames = response.body.map((g: { name: string }) => g.name);
        expect(groupNames).toContain('Group A');
        expect(groupNames).toContain('Group B');
      });

      it('should include group members in response', async () => {
        const { token } = await createAdminAndLogin();
        const { userId, username } = await createUserAndLogin();

        const group = await prisma.group.create({
          data: {
            name: 'Test Group',
            members: {
              create: { userId, role: 'member' },
            },
          },
        });

        const response = await request(app)
          .get('/api/v1/admin/groups')
          .set(authHeader(token))
          .expect(200);

        const testGroup = response.body.find((g: { id: string }) => g.id === group.id);
        expect(testGroup.members).toHaveLength(1);
        expect(testGroup.members[0].username).toBe(username);
      });

      it('should deny access to non-admin', async () => {
        const { token } = await createUserAndLogin();

        await request(app)
          .get('/api/v1/admin/groups')
          .set(authHeader(token))
          .expect(403);
      });
    });

    describe('POST /api/v1/admin/groups', () => {
      it('should create a new group', async () => {
        const { token } = await createAdminAndLogin();

        const response = await request(app)
          .post('/api/v1/admin/groups')
          .set(authHeader(token))
          .send({
            name: 'New Group',
            description: 'A test group',
            purpose: 'testing',
          })
          .expect(201);

        expect(response.body.name).toBe('New Group');
        expect(response.body.description).toBe('A test group');
        expect(response.body.purpose).toBe('testing');

        // Verify in database
        const group = await prisma.group.findUnique({
          where: { id: response.body.id },
        });
        expect(group).not.toBeNull();
      });

      it('should create group with initial members', async () => {
        const { token } = await createAdminAndLogin();
        const { userId: user1Id } = await createUserAndLogin();
        const { userId: user2Id } = await createUserAndLogin();

        const response = await request(app)
          .post('/api/v1/admin/groups')
          .set(authHeader(token))
          .send({
            name: 'Group with Members',
            memberIds: [user1Id, user2Id],
          })
          .expect(201);

        expect(response.body.members).toHaveLength(2);

        // Verify memberships in database
        const memberships = await prisma.groupMember.findMany({
          where: { groupId: response.body.id },
        });
        expect(memberships).toHaveLength(2);
      });

      it('should skip invalid member IDs', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        const response = await request(app)
          .post('/api/v1/admin/groups')
          .set(authHeader(token))
          .send({
            name: 'Group with Mixed Members',
            memberIds: [userId, '00000000-0000-0000-0000-000000000000'],
          })
          .expect(201);

        // Only the valid user should be added
        expect(response.body.members).toHaveLength(1);
      });

      it('should reject group without name', async () => {
        const { token } = await createAdminAndLogin();

        await request(app)
          .post('/api/v1/admin/groups')
          .set(authHeader(token))
          .send({ description: 'No name group' })
          .expect(400);
      });
    });

    describe('PUT /api/v1/admin/groups/:groupId', () => {
      it('should update group name and description', async () => {
        const { token } = await createAdminAndLogin();

        const group = await prisma.group.create({
          data: { name: 'Original Name', description: 'Original Desc' },
        });

        const response = await request(app)
          .put(`/api/v1/admin/groups/${group.id}`)
          .set(authHeader(token))
          .send({
            name: 'Updated Name',
            description: 'Updated Description',
          })
          .expect(200);

        expect(response.body.name).toBe('Updated Name');
        expect(response.body.description).toBe('Updated Description');
      });

      it('should update group members', async () => {
        const { token } = await createAdminAndLogin();
        const { userId: user1Id } = await createUserAndLogin();
        const { userId: user2Id } = await createUserAndLogin();
        const { userId: user3Id } = await createUserAndLogin();

        // Create group with user1 and user2
        const group = await prisma.group.create({
          data: {
            name: 'Test Group',
            members: {
              createMany: {
                data: [
                  { userId: user1Id, role: 'member' },
                  { userId: user2Id, role: 'member' },
                ],
              },
            },
          },
        });

        // Update to user2 and user3 (remove user1, add user3)
        const response = await request(app)
          .put(`/api/v1/admin/groups/${group.id}`)
          .set(authHeader(token))
          .send({ memberIds: [user2Id, user3Id] })
          .expect(200);

        expect(response.body.members).toHaveLength(2);

        // Verify user1 is removed, user3 is added
        const memberships = await prisma.groupMember.findMany({
          where: { groupId: group.id },
        });
        const memberUserIds = memberships.map(m => m.userId);
        expect(memberUserIds).not.toContain(user1Id);
        expect(memberUserIds).toContain(user2Id);
        expect(memberUserIds).toContain(user3Id);
      });

      it('should return 404 for non-existent group', async () => {
        const { token } = await createAdminAndLogin();

        await request(app)
          .put('/api/v1/admin/groups/00000000-0000-0000-0000-000000000000')
          .set(authHeader(token))
          .send({ name: 'Test' })
          .expect(404);
      });
    });

    describe('DELETE /api/v1/admin/groups/:groupId', () => {
      it('should delete a group', async () => {
        const { token } = await createAdminAndLogin();

        const group = await prisma.group.create({
          data: { name: 'Group to Delete' },
        });

        await request(app)
          .delete(`/api/v1/admin/groups/${group.id}`)
          .set(authHeader(token))
          .expect(200);

        // Verify group is deleted
        const deletedGroup = await prisma.group.findUnique({
          where: { id: group.id },
        });
        expect(deletedGroup).toBeNull();
      });

      it('should cascade delete group memberships', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        const group = await prisma.group.create({
          data: {
            name: 'Group with Members',
            members: {
              create: { userId, role: 'member' },
            },
          },
        });

        await request(app)
          .delete(`/api/v1/admin/groups/${group.id}`)
          .set(authHeader(token))
          .expect(200);

        // Verify memberships are also deleted
        const memberships = await prisma.groupMember.findMany({
          where: { groupId: group.id },
        });
        expect(memberships).toHaveLength(0);
      });

      it('should return 404 for non-existent group', async () => {
        const { token } = await createAdminAndLogin();

        await request(app)
          .delete('/api/v1/admin/groups/00000000-0000-0000-0000-000000000000')
          .set(authHeader(token))
          .expect(404);
      });
    });

    describe('POST /api/v1/admin/groups/:groupId/members', () => {
      it('should add a member to a group', async () => {
        const { token } = await createAdminAndLogin();
        const { userId, username } = await createUserAndLogin();

        const group = await prisma.group.create({
          data: { name: 'Test Group' },
        });

        const response = await request(app)
          .post(`/api/v1/admin/groups/${group.id}/members`)
          .set(authHeader(token))
          .send({ userId, role: 'member' })
          .expect(201);

        expect(response.body.userId).toBe(userId);
        expect(response.body.username).toBe(username);
        expect(response.body.role).toBe('member');

        // Verify in database
        const membership = await prisma.groupMember.findUnique({
          where: { userId_groupId: { userId, groupId: group.id } },
        });
        expect(membership).not.toBeNull();
      });

      it('should add member as admin role', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        const group = await prisma.group.create({
          data: { name: 'Test Group' },
        });

        const response = await request(app)
          .post(`/api/v1/admin/groups/${group.id}/members`)
          .set(authHeader(token))
          .send({ userId, role: 'admin' })
          .expect(201);

        expect(response.body.role).toBe('admin');
      });

      it('should reject duplicate membership', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        const group = await prisma.group.create({
          data: {
            name: 'Test Group',
            members: {
              create: { userId, role: 'member' },
            },
          },
        });

        await request(app)
          .post(`/api/v1/admin/groups/${group.id}/members`)
          .set(authHeader(token))
          .send({ userId })
          .expect(409);
      });

      it('should return 404 for non-existent group', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        await request(app)
          .post('/api/v1/admin/groups/00000000-0000-0000-0000-000000000000/members')
          .set(authHeader(token))
          .send({ userId })
          .expect(404);
      });

      it('should return 404 for non-existent user', async () => {
        const { token } = await createAdminAndLogin();

        const group = await prisma.group.create({
          data: { name: 'Test Group' },
        });

        await request(app)
          .post(`/api/v1/admin/groups/${group.id}/members`)
          .set(authHeader(token))
          .send({ userId: '00000000-0000-0000-0000-000000000000' })
          .expect(404);
      });
    });

    describe('DELETE /api/v1/admin/groups/:groupId/members/:userId', () => {
      it('should remove a member from a group', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        const group = await prisma.group.create({
          data: {
            name: 'Test Group',
            members: {
              create: { userId, role: 'member' },
            },
          },
        });

        await request(app)
          .delete(`/api/v1/admin/groups/${group.id}/members/${userId}`)
          .set(authHeader(token))
          .expect(200);

        // Verify membership is removed
        const membership = await prisma.groupMember.findUnique({
          where: { userId_groupId: { userId, groupId: group.id } },
        });
        expect(membership).toBeNull();
      });

      it('should return 404 for non-existent membership', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        const group = await prisma.group.create({
          data: { name: 'Test Group' },
        });

        await request(app)
          .delete(`/api/v1/admin/groups/${group.id}/members/${userId}`)
          .set(authHeader(token))
          .expect(404);
      });
    });
  });
}
