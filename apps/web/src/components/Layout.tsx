import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { useTheme } from "../lib/theme.js";
import { useIsMobile } from "../hooks/use-mobile.js";
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
  PanelLeft,
} from "lucide-react";

const SIDEBAR_COLLAPSED_KEY = "dripline-sidebar-collapsed";

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
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 group-data-[collapsed=true]:w-auto group-data-[collapsed=true]:justify-center group-data-[collapsed=true]:px-2"
        >
          {icon}
          <span className="capitalize group-data-[collapsed=true]:hidden">{theme}</span>
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
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true",
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  function toggleSidebar() {
    if (isMobile) setMobileOpen((open) => !open);
    else setCollapsed((c) => !c);
  }

  return (
    <div className="bg-background flex h-screen overflow-hidden">
      <Sidebar collapsed={collapsed} mobileOpen={mobileOpen}>
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
                        <NavLink to={link.to} end={link.end}>
                          <link.icon className="h-5 w-5 shrink-0" />
                          <span className="group-data-[collapsed=true]:hidden">{link.label}</span>
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
          <div className="text-muted-foreground truncate px-2 py-1 text-xs group-data-[collapsed=true]:hidden">
            {user?.email}
          </div>
          <div className="group-data-[collapsed=true]:hidden">
            <SourceLink />
          </div>
          <ThemeToggle />
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 group-data-[collapsed=true]:w-auto group-data-[collapsed=true]:justify-center group-data-[collapsed=true]:px-2"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className="group-data-[collapsed=true]:hidden">Log out</span>
          </Button>
        </SidebarFooter>
      </Sidebar>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="bg-background/95 sticky top-0 z-30 flex items-center border-b px-4 py-2 backdrop-blur">
          <Button
            variant="ghost"
            size="sm-icon"
            tooltip={
              isMobile
                ? mobileOpen
                  ? "Close menu"
                  : "Open menu"
                : collapsed
                  ? "Expand sidebar"
                  : "Collapse sidebar"
            }
            onClick={toggleSidebar}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        </div>
        <main className="bg-background flex-1 overflow-auto">
          <div className="mx-auto max-w-[1200px] px-8 py-10">
            <Outlet />
          </div>
        </main>
      </div>
      <Toaster />
    </div>
  );
}
