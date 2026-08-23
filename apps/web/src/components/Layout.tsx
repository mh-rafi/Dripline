import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
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

const navLinks = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/subscribers", label: "Subscribers", icon: Users, end: false },
  { to: "/lists", label: "Lists", icon: List, end: false },
  { to: "/templates", label: "Templates", icon: FileText, end: false },
  { to: "/campaigns", label: "Campaigns", icon: Mail, end: false },
  { to: "/workflows", label: "Workflows", icon: Workflow, end: false },
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
