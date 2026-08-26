import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Role, User } from "../lib/types.js";
import Badge from "../components/Badge.js";
import {
  PageHeaderWrapper,
  BlockLayout,
  Button,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  Popconfirm,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  toast,
} from "../components/ui/index.js";

export default function Settings() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);

  function loadUsers() {
    api.get<User[]>("/users").then(setUsers);
  }
  function loadRoles() {
    api.get<Role[]>("/roles").then(setRoles);
  }
  useEffect(() => {
    loadUsers();
    loadRoles();
  }, []);

  async function removeUser(id: number) {
    await api.delete(`/users/${id}`);
    loadUsers();
    toast.success("User deleted");
  }

  async function removeRole(id: number) {
    try {
      await api.delete(`/roles/${id}`);
      loadRoles();
      toast.success("Role deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to delete role");
    }
  }

  return (
    <div>
      <PageHeaderWrapper variant="title-only" title="Settings" />

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <BlockLayout padding="sm">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-muted-foreground text-sm">
                A <strong>user</strong> logs in with email and password. An <strong>API</strong>{" "}
                user has no email or password — it authenticates with a token, scoped by its role,
                for integrating external services with Dripline's HTTP API.
              </p>
              <Button asChild>
                <Link to="/settings/users/new">New user</Link>
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <Link to={`/settings/users/${u.id}`} className="text-primary hover:underline">
                        {u.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.email ?? <span>—</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.type}</TableCell>
                    <TableCell className="text-muted-foreground">{u.role_name}</TableCell>
                    <TableCell>
                      <Badge status={u.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.last_used_at ? new Date(u.last_used_at).toLocaleString() : "never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/settings/users/${u.id}`}>Edit</Link>
                        </Button>
                        <Popconfirm
                          description="Delete this user?"
                          onConfirm={() => removeUser(u.id)}
                          confirmText="Delete"
                        >
                          <Button variant="outline" size="sm">
                            Delete
                          </Button>
                        </Popconfirm>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {users.length === 0 && (
              <TableEmptyState title="No users yet" description="Add one to get started." />
            )}
          </BlockLayout>
        </TabsContent>

        <TabsContent value="roles">
          <BlockLayout padding="sm">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-muted-foreground text-sm">
                A role is a named set of permissions. Every user is assigned exactly one role.
              </p>
              <Button asChild>
                <Link to="/settings/roles/new">New role</Link>
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((r) => {
                  const isSuperAdmin = r.id === 1;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        {isSuperAdmin ? (
                          r.name
                        ) : (
                          <Link
                            to={`/settings/roles/${r.id}`}
                            className="text-primary hover:underline"
                          >
                            {r.name}
                          </Link>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {isSuperAdmin ? "All permissions" : `${r.permissions.length} granted`}
                      </TableCell>
                      <TableCell className="text-right">
                        {isSuperAdmin ? (
                          <span
                            className="text-muted-foreground text-sm"
                            title="The built-in Super Admin role can't be edited or deleted"
                          >
                            built-in
                          </span>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" asChild>
                              <Link to={`/settings/roles/${r.id}`}>Edit</Link>
                            </Button>
                            <Popconfirm
                              description="Delete this role?"
                              onConfirm={() => removeRole(r.id)}
                              confirmText="Delete"
                            >
                              <Button variant="outline" size="sm">
                                Delete
                              </Button>
                            </Popconfirm>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {roles.length === 0 && <TableEmptyState title="No roles" description="" />}
          </BlockLayout>
        </TabsContent>
      </Tabs>
    </div>
  );
}
