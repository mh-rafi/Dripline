import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { useTheme } from "../lib/theme.js";
import { cn } from "../lib/utils.js";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  Logo,
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  Toaster,
  Button,
} from "./ui/index.js";
import {
  Sun,
  Moon,
  Monitor,
  LogOut,
  LayoutDashboard,
  Users,
  List,
  Mail,
  Workflow,
  Plug,
  Settings as SettingsIcon,
  FileText,
} from "lucide-react";

interface Meta {
  version: string;
  source_url: string;
  license: string;
}

// AGPL-3.0 section 13 requires that users interacting with a network-deployed
// modified version are offered its corresponding source. The API reports where
// that is (SOURCE_URL), so a fork only has to set the env var.
function SourceLink() {
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    api
      .get<Meta>("/meta")
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);

  if (!meta) return null;
  return (
    <a
      href={meta.source_url}
      target="_blank"
      rel="noreferrer"
      className="text-muted-foreground hover:text-foreground truncate px-2 py-1 text-xs"
    >
      Dripline {meta.version} &middot; {meta.license} source
    </a>
  );
}

const navLinks = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/subscribers", label: "Subscribers", icon: Users, end: false },
  { to: "/lists", label: "Lists", icon: List, end: false },
  { to: "/templates", label: "Templates", icon: FileText, end: false },
  { to: "/campaigns", label: "Campaigns", icon: Mail, end: false },
  { to: "/automations", label: "Automations", icon: Workflow, end: false },
  { to: "/connections", label: "Connections", icon: Plug, end: false },
  { to: "/settings", label: "Settings", icon: SettingsIcon, end: false },
];

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const icon =
    theme === "light" ? (
      <Sun className="h-4 w-4" />
    ) : theme === "dark" ? (
      <Moon className="h-4 w-4" />
    ) : (
      <Monitor className="h-4 w-4" />
    );
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-start gap-2">
          {icon}
          <span className="capitalize">{theme}</span>
        </Button>
      </DropdownTrigger>
      <DropdownContent align="start" size="sm">
        <DropdownItem onClick={() => setTheme("light")}>
          <Sun className="mr-2 h-4 w-4" /> Light
        </DropdownItem>
        <DropdownItem onClick={() => setTheme("dark")}>
          <Moon className="mr-2 h-4 w-4" /> Dark
        </DropdownItem>
        <DropdownItem onClick={() => setTheme("system")}>
          <Monitor className="mr-2 h-4 w-4" /> System
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="bg-background flex h-screen overflow-hidden">
      <Sidebar>
        <SidebarHeader>
          <Logo />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navLinks.map((link) => {
                  const isActive = link.end
                    ? location.pathname === link.to
                    : location.pathname === link.to || location.pathname.startsWith(`${link.to}/`);
                  return (
                    <SidebarMenuItem key={link.to}>
                      <SidebarMenuButton asChild isActive={isActive}>
                        <NavLink
                          to={link.to}
                          end={link.end}
                          className={cn("flex w-full items-center gap-2")}
                        >
                          <link.icon className="h-4 w-4" />
                          <span>{link.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="text-muted-foreground truncate px-2 py-1 text-xs">{user?.email}</div>
          <SourceLink />
          <ThemeToggle />
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            <LogOut className="h-4 w-4" /> Log out
          </Button>
        </SidebarFooter>
      </Sidebar>
      <main className="bg-background flex-1 overflow-auto">
        <div className="mx-auto max-w-[1200px] px-8 py-10">
          <Outlet />
        </div>
      </main>
      <Toaster />
    </div>
  );
}
