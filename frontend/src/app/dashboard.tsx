"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import QRCode from "qrcode";
import styles from "./authenticator.module.css";
import settingsStyles from "./settings.module.css";
import paymentStyles from "./payments.module.css";
import labelStyles from "./labels.module.css";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  ExternalLink,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  MapPin,
  Menu,
  MoreHorizontal,
  Package,
  PackageCheck,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Truck,
  Users,
  X,
  Route,
  Copy,
  Printer,
  LockKeyhole,
  Mail,
  CalendarDays,
  ChartNoAxesCombined,
} from "lucide-react";

type Role = "CLIENT" | "COURIER" | "ADMIN";
type Status = "CREATED" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED";
type PaymentStatus = "UNPAID" | "PAID";
type History = { status: Status; location: string; timestamp: string };
type ManagedUser = {
  id: string;
  email: string;
  role: Role;
  is2faEnabled: boolean;
};
type Parcel = {
  id: string;
  trackingNumber: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  city: string;
  postalCode: string;
  size: "S" | "M" | "L";
  weight: number;
  service: "STANDARD" | "EXPRESS";
  price: number;
  paymentStatus: PaymentStatus;
  paidAt: string | null;
  status: Status;
  createdAt: string;
  estimatedDelivery: string;
  history: History[];
  demoPickupCode?: string;
  notificationStatus?: "SENT" | "NOT_CONFIGURED" | "FAILED";
};
type Tracking = Pick<
  Parcel,
  "trackingNumber" | "city" | "status" | "estimatedDelivery" | "history"
>;
type View = "overview" | "parcels" | "tracking" | "reports" | "settings" | "users";
const statusNames: Record<Status, string> = {
  CREATED: "Do nadania",
  IN_TRANSIT: "W drodze",
  OUT_FOR_DELIVERY: "W doręczeniu",
  DELIVERED: "Doręczona",
};
const roleNames: Record<Role, string> = {
  CLIENT: "Panel klienta",
  COURIER: "Panel kuriera",
  ADMIN: "Administracja",
};
const money = (value: number) =>
  (value / 100).toLocaleString("pl-PL", { style: "currency", currency: "PLN" });
const date = (value: string, long = false) =>
  new Date(value).toLocaleDateString(
    "pl-PL",
    long
      ? { day: "numeric", month: "long", year: "numeric" }
      : { day: "2-digit", month: "short" },
  );
const time = (value: string) =>
  new Date(value).toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });
const statusOrder: Status[] = [
  "CREATED",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];
const navItems = [
  { id: "overview" as const, label: "Pulpit", icon: LayoutDashboard },
  { id: "parcels" as const, label: "Moje przesyłki", icon: Package },
  { id: "tracking" as const, label: "Śledzenie przesyłki", icon: Route },
  {
    id: "reports" as const,
    label: "Raporty i koszty",
    icon: ChartNoAxesCombined,
  },
  { id: "users" as const, label: "Użytkownicy", icon: Users },
];
function routeForView(view: View) {
  return {
    overview: "/",
    parcels: "/parcels",
    tracking: "/tracking",
    reports: "/reports",
    settings: "/settings",
    users: "/admin/users",
  }[view];
}
function viewForPath(pathname: string): View {
  if (pathname === "/admin/users") return "users";
  if (pathname === "/parcels" || pathname.startsWith("/parcels/")) return "parcels";
  if (pathname === "/tracking" || pathname.startsWith("/tracking/")) return "tracking";
  if (pathname === "/reports") return "reports";
  if (pathname === "/settings") return "settings";
  return "overview";
}
function Badge({ status }: { status: Status }) {
  return (
    <span className={`badge ${status.toLowerCase()}`}>
      <i />
      {statusNames[status]}
    </span>
  );
}

export default function Dashboard() {
  const token = useRef("");
  const pathname = usePathname();
  const router = useRouter();
  const view = viewForPath(pathname);
  const trackingNumberFromPath = pathname.match(/^\/tracking\/([^/]+)$/)?.[1];
  const linkedTrackingNumber = trackingNumberFromPath
    ? decodeURIComponent(trackingNumberFromPath)
    : null;
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [emailReady, setEmailReady] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [role, setRole] = useState<Role>("CLIENT");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Status | "ALL">("ALL");
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState("7");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Parcel | null>(null);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [trackNumber, setTrackNumber] = useState(() =>
    trackingNumberFromPath ? decodeURIComponent(trackingNumberFromPath) : "",
  );
  const [labelQr, setLabelQr] = useState("");
  const [trackError, setTrackError] = useState("");
  const [toast, setToast] = useState("");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState<Role | "ALL">("ALL");
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState("");
  const [authStep, setAuthStep] = useState("");
  const [setup, setSetup] = useState<{
    secret: string;
    uri: string;
    qrCode: string;
  } | null>(null);
  async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`/api${path}`, {
      ...options,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(token.current ? { Authorization: `Bearer ${token.current}` } : {}),
        ...options.headers,
      },
    });
    if (response.status === 401 && token.current && path !== "/auth/refresh") {
      const refresh = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (refresh.ok) {
        token.current = (await refresh.json()).accessToken;
        return api<T>(path, options);
      }
      token.current = "";
      setLoginOpen(true);
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || "Nie udało się połączyć z API.");
    }
    return response.status === 204 ? (undefined as T) : response.json();
  }
  async function load() {
    setParcels(await api<Parcel[]>("/parcels"));
  }
  useEffect(() => {
    if (demo || role !== "ADMIN" || !token.current) {
      setManagedUsers([]);
      return;
    }
    let active = true;
    fetch("/api/admin/users", {
      headers: { Authorization: `Bearer ${token.current}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Nie udało się wczytać kont.");
        return response.json() as Promise<ManagedUser[]>;
      })
      .then((users) => {
        if (active) setManagedUsers(users);
      })
      .catch((error: unknown) => {
        if (active) setToast((error as Error).message);
      });
    return () => {
      active = false;
    };
  }, [demo, role]);
  useEffect(() => {
    if (!selected?.trackingNumber) return;
    let active = true;
    const url = new URL(
      `/tracking/${encodeURIComponent(selected.trackingNumber)}`,
      window.location.origin,
    ).toString();
    QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 180 })
      .then((qr) => {
        if (active) setLabelQr(qr);
      })
      .catch(() => {
        if (active) setLabelQr("");
      });
    return () => {
      active = false;
    };
  }, [selected?.trackingNumber]);
  useEffect(() => {
    if (!trackingNumberFromPath || loading || tracking?.trackingNumber === decodeURIComponent(trackingNumberFromPath)) return;
    let active = true;
    const number = decodeURIComponent(trackingNumberFromPath);
    fetch(`/api/track/${encodeURIComponent(number)}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Nie udało się znaleźć przesyłki.");
        return result as Tracking;
      })
      .then((result) => {
        if (active) {
          setTrackNumber(number);
          setTracking(result);
          setTrackError("");
        }
      })
      .catch((error: unknown) => {
        if (active) setTrackError((error as Error).message);
      });
    return () => {
      active = false;
    };
  }, [trackingNumberFromPath, loading, tracking?.trackingNumber]);
  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const health = await fetch("/api/health").then((response) => {
          if (!response.ok)
            throw new Error(
              "API jest niedostępne. Sprawdź, czy backend działa na porcie 4000.",
            );
          return response.json();
        });
        if (!active) return;
        setDemo(health.demo);
        setEmailConfigured(health.emailConfigured);
        setEmailReady(health.emailNotifications);
        const savedRole = window.sessionStorage.getItem("demo-role");
        const initialRole =
          savedRole === "COURIER" || savedRole === "ADMIN"
            ? savedRole
            : "CLIENT";
        const response = await fetch(
          health.demo ? "/api/auth/demo" : "/api/auth/refresh",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: health.demo ? JSON.stringify({ role: initialRole }) : undefined,
          },
        );
        if (!active) return;
        if (!response.ok) {
          setLoginOpen(true);
          return;
        }
        const session = await response.json();
        token.current = session.accessToken;
        setRole(session.user.role);
        const accountResponse = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (!accountResponse.ok) throw new Error('Nie udało się wczytać ustawień konta.');
        const account = await accountResponse.json() as { is2faEnabled: boolean };
        if (active) setTwoFactorEnabled(account.is2faEnabled);
        const data = await fetch("/api/parcels", {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (!data.ok) throw new Error("Nie udało się pobrać przesyłek.");
        if (active) setParcels(await data.json());
      } catch (error) {
        if (active) setFatal((error as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const detailTrackingNumber = pathname.match(/^\/parcels\/([^/]+)$/)?.[1];
  useEffect(() => {
    if (loading || !detailTrackingNumber || !token.current) return;
    let active = true;
    fetch(`/api/parcels/${encodeURIComponent(detailTrackingNumber)}`, {
      headers: { Authorization: `Bearer ${token.current}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Nie udało się wczytać przesyłki.");
        return response.json() as Promise<Parcel>;
      })
      .then((parcel) => {
        if (active) setSelected(parcel);
      })
      .catch((error: unknown) => {
        if (active) setToast((error as Error).message);
      });
    return () => {
      active = false;
    };
  }, [detailTrackingNumber, loading, role]);
  useEffect(() => {
    document.body.style.overflow =
      createOpen || selected || loginOpen ? "hidden" : "";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCreateOpen(false);
        setSelected(null);
        if (/^\/parcels\/[^/]+$/.test(window.location.pathname)) {
          router.push("/parcels");
        }
        if (token.current) setLoginOpen(false);
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", escape);
    };
  }, [createOpen, selected, loginOpen, router]);
  const counts = Object.fromEntries(
    statusOrder.map((status) => [
      status,
      parcels.filter((parcel) => parcel.status === status).length,
    ]),
  ) as Record<Status, number>;
  const filtered = parcels.filter(
    (parcel) =>
      (filter === "ALL" || parcel.status === filter) &&
      `${parcel.trackingNumber} ${parcel.recipientName} ${parcel.city}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const filteredManagedUsers = managedUsers.filter(
    (user) =>
      (userRoleFilter === "ALL" || user.role === userRoleFilter) &&
      user.email.toLowerCase().includes(userSearch.toLowerCase()),
  );
  const pageSize = view === "overview" ? 5 : 8;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(
    (Math.min(page, pageCount) - 1) * pageSize,
    Math.min(page, pageCount) * pageSize,
  );
  const totalCost = parcels.reduce((total, parcel) => total + parcel.price, 0);
  const paidTotal = parcels
    .filter((parcel) => parcel.paymentStatus === "PAID")
    .reduce((total, parcel) => total + parcel.price, 0);
  const unpaidTotal = totalCost - paidTotal;
  const days = Array.from({ length: Number(period) }, (_, index) => {
    const day = new Date();
    day.setDate(day.getDate() - Number(period) + 1 + index);
    const items = parcels.filter(
      (parcel) =>
        new Date(parcel.createdAt).toDateString() === day.toDateString(),
    );
    return {
      day,
      sent: items.length,
      delivered: items.filter((parcel) => parcel.status === "DELIVERED").length,
    };
  });
  const chartMax = Math.max(5, ...days.map((day) => day.sent));
  const nextParcel = parcels.find((parcel) => parcel.status === "CREATED");
  const activities = parcels
    .flatMap((parcel) =>
      parcel.history.map((event) => ({
        ...event,
        trackingNumber: parcel.trackingNumber,
        id: parcel.id,
      })),
    )
    .sort((first, second) => second.timestamp.localeCompare(first.timestamp))
    .slice(0, 3);
  function go(next: View) {
    router.push(routeForView(next));
    setSelected(null);
    if (next === "tracking") {
      setTrackNumber("");
      setTracking(null);
      setTrackError("");
    }
    setMobileOpen(false);
    setPage(1);
    setSearch("");
    setFilter("ALL");
  }
  function openParcel(parcel: Parcel) {
    setSelected(parcel);
    router.push(`/parcels/${encodeURIComponent(parcel.trackingNumber)}`);
  }
  function closeParcel() {
    setSelected(null);
    if (/^\/parcels\/[^/]+$/.test(pathname)) router.push("/parcels");
  }
  async function switchRole(nextRole: Role) {
    try {
      const session = await api<{ accessToken: string }>("/auth/demo", {
        method: "POST",
        body: JSON.stringify({ role: nextRole }),
      });
      window.sessionStorage.setItem("demo-role", nextRole);
      token.current = session.accessToken;
      setRole(nextRole);
      await load();
      go("overview");
      setToast(`Aktywny widok: ${roleNames[nextRole]}`);
    } catch (error) {
      setToast((error as Error).message);
    }
  }
  function exportCsv() {
    const rows = [
      ["Numer przesyłki", "Miasto", "Status", "Data nadania", "Koszt PLN"],
      ...filtered.map((parcel) => [
        parcel.trackingNumber,
        parcel.city,
        statusNames[parcel.status],
        date(parcel.createdAt),
        (parcel.price / 100).toFixed(2),
      ]),
    ];
    const text =
      "\uFEFF" +
      rows
        .map((row) =>
          row
            .map(
              (cell) =>
                `"${String(cell)
                  .replace(/^[=+@-]/, "'")
                  .replaceAll('"', '""')}"`,
            )
            .join(";"),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "przesylki.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("Raport CSV został pobrany.");
  }
  async function track(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setTrackError("");
    setTracking(null);
    try {
      const number = trackNumber.trim().toUpperCase();
      setTracking(await api<Tracking>(`/track/${encodeURIComponent(number)}`));
      router.push(`/tracking/${encodeURIComponent(number)}`);
    } catch (error) {
      setTrackError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function createParcel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const parcel = await api<Parcel>("/parcels", {
        method: "POST",
        body: JSON.stringify({
          recipientName: data.get("name"),
          recipientPhone: data.get("phone"),
          recipientEmail: data.get("email"),
          recipientAddress: data.get("address"),
          city: data.get("city"),
          postalCode: data.get("postal"),
          size: data.get("size"),
          weight: Number(data.get("weight")),
          service: data.get("service"),
        }),
      });
      await load();
      setCreateOpen(false);
      openParcel(parcel);
      setToast(
        parcel.notificationStatus === "SENT"
          ? "Przesyłka utworzona. Kod odbioru wysłano e-mailem."
          : parcel.notificationStatus === "FAILED"
            ? "Przesyłka utworzona, ale e-mail nie został wysłany."
            : "Przesyłka utworzona. Skonfiguruj SMTP, aby wysyłać e-maile.",
      );
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function createManagedUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const user = await api<ManagedUser>("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: data.get("email"),
          password: data.get("password"),
          fullName: data.get("fullName"),
          role: data.get("role"),
        }),
      });
      setManagedUsers((current) =>
        [...current, user].sort((first, second) =>
          first.email.localeCompare(second.email),
        ),
      );
      setCreateUserOpen(false);
      setToast(`Utworzono konto ${user.email}.`);
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function simulatePayment() {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await api<Parcel>(`/parcels/${selected.id}/pay`, {
        method: "POST",
      });
      setSelected(updated);
      await load();
      setToast("Płatność testowa zatwierdzona. Nie pobrano pieniędzy.");
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changeStatus(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const updated = await api<Parcel>(`/parcels/${selected.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status: statusOrder[statusOrder.indexOf(selected.status) + 1],
          ...(data.get("pin") ? { pickupCode: data.get("pin") } : {}),
          ...(data.get("courier") ? { courierId: data.get("courier") } : {}),
        }),
      });
      setSelected(updated);
      await load();
      setToast(
        updated.notificationStatus === "SENT"
          ? "Status zaktualizowany. Wysłano powiadomienie e-mail."
          : updated.notificationStatus === "FAILED"
            ? "Status zaktualizowany, ale e-mail nie został wysłany."
            : "Status przesyłki został zaktualizowany.",
      );
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disableTwoFactor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await api('/auth/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({
          password: data.get('password'),
          code: data.get('code'),
        }),
      });
      setTwoFactorEnabled(false);
      setSetup(null);
      setToast('Weryfikacja dwuetapowa została odłączona.');
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{
        accessToken?: string;
        requires2fa?: boolean;
        preAuthToken?: string;
        user?: { role: Role };
      }>(authStep ? "/auth/verify-2fa" : "/auth/login", {
        method: "POST",
        body: JSON.stringify(
          authStep
            ? { preAuthToken: authStep, code: data.get("code") }
            : { email: data.get("email"), password: data.get("password") },
        ),
      });
      if (result.requires2fa) {
        setAuthStep(result.preAuthToken!);
        return;
      }
      token.current = result.accessToken!;
      setRole(result.user!.role);
      const account = await api<{ is2faEnabled: boolean }>('/auth/me');
      setTwoFactorEnabled(account.is2faEnabled);
      await load();
      setLoginOpen(false);
      setAuthStep("");
      setFatal("");
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Zamknij menu"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <Link className="brand" href="/" aria-label="przesyłka, strona główna">
          <span className="brand-icon">
            <Package size={24} strokeWidth={2.1} />
          </span>
          przesyłka<span className="brand-dot">.</span>
        </Link>
        <div className="workspace">
          <div className="workspace-avatar">AK</div>
          <div>
            <strong>Moja przestrzeń</strong>
            <span>{roleNames[role]}</span>
          </div>
          <ChevronDown size={15} />
        </div>
        <span className="nav-heading">PRZESTRZEŃ ROBOCZA</span>
        <nav>
          {navItems
            .filter(({ id }) => id !== "users" || (role === "ADMIN" && !demo))
            .map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? "active" : ""}`}
              onClick={() => go(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "parcels" && <b>{parcels.length}</b>}
            </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-note">
            <ShieldCheck size={23} />
            <strong>
              Twoje paczki.
              <br />
              Pod dobrą opieką.
            </strong>
            <span>Bezpiecznie na każdym etapie.</span>
            <div>
              <i />
              Połączenie z API {fatal ? "niedostępne" : "aktywne"}
            </div>
          </div>
          <button
            className={`nav-item ${view === "settings" ? "active" : ""}`}
            onClick={() => go("settings")}
          >
            <Settings2 size={19} />
            Ustawienia konta
          </button>
          <a className="nav-item" href="mailto:pomoc@przesylka.example">
            <CircleHelp size={19} />
            Centrum pomocy
            <ExternalLink size={13} className="push-right" />
          </a>
          <div className="sidebar-footer">
            <span className="tiny-brand">przesyłka.</span>
            <span>© {new Date().getFullYear()}</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Otwórz menu"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span>Moja przestrzeń</span>
            <ChevronRight size={14} />
            <strong>
              {view === "settings"
                ? "Ustawienia"
                : navItems.find((item) => item.id === view)?.label}
            </strong>
          </div>
          <div className="header-actions">
            <div className="notification-wrap">
              <button
                className="icon-button notification-button"
                aria-label="Powiadomienia"
                onClick={() => setNoticeOpen(!noticeOpen)}
              >
                <Bell size={20} />
                {activities.length > 0 && <i />}
              </button>
              {noticeOpen && (
                <div className="notification-popover">
                  <strong>Ostatnie powiadomienia</strong>
                  {activities.map((activity, index) => (
                    <button
                      key={index}
                      onClick={() => {
                        openParcel(
                          parcels.find((parcel) => parcel.id === activity.id)!,
                        );
                        setNoticeOpen(false);
                      }}
                    >
                      <PackageCheck size={17} />
                      <span>
                        {statusNames[activity.status]}
                        <small>{activity.trackingNumber}</small>
                      </span>
                      <ChevronRight size={14} />
                    </button>
                  ))}
                  {!activities.length && <p>Brak nowych powiadomień.</p>}
                </div>
              )}
            </div>
            <span className="header-divider" />
            <button className="profile" onClick={() => go("settings")}>
              <span className="profile-avatar">AK</span>
              <span>
                <strong>{demo ? "Aleksandra Kowalska" : "Moje konto"}</strong>
                <small>{roleNames[role]}</small>
              </span>
              <ChevronDown size={14} />
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <i />
                {new Date().toLocaleDateString("pl-PL", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </div>
              <h1>
                {view === "overview"
                  ? "Wszystko na dobrej drodze."
                  : view === "parcels"
                    ? "Twoje przesyłki"
                    : view === "tracking"
                      ? "Gdzie jest Twoja paczka?"
                      : view === "reports"
                        ? "Raporty i koszty"
                        : view === "users"
                          ? "Użytkownicy"
                          : "Ustawienia konta"}
              </h1>
              <p>
                {view === "overview"
                  ? "Dzień dobry, Aleksandra. Oto co słychać u Twoich przesyłek."
                  : view === "parcels"
                    ? "Każda paczka i każdy etap, w jednym miejscu."
                    : view === "tracking"
                      ? "Sprawdź aktualny status i historię podróży przesyłki."
                      : view === "reports"
                        ? "Podsumowanie Twojej aktywności wysyłkowej."
                        : view === "users"
                          ? "Zarządzaj kontami klientów i kurierów."
                          : "Twoja przestrzeń, prywatność i bezpieczeństwo."}
              </p>
            </div>
            {view !== "settings" && view !== "users" && (
              <button
                className="button primary"
                onClick={() => {
                  if (!token.current) setLoginOpen(true);
                  else if (role === "COURIER") go("parcels");
                  else setCreateOpen(true);
                }}
              >
                <Plus size={18} />
                {role === "COURIER" ? "Moje doręczenia" : "Nadaj przesyłkę"}
              </button>
            )}
          </div>
          {fatal && (
            <div className="error-banner">
              <CircleHelp size={18} />
              <span>{fatal}</span>
              <button onClick={() => location.reload()}>
                Ponów połączenie
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading-state">
              <LoaderCircle className="spin" size={28} />
              <span>Wczytywanie Twojej przestrzeni…</span>
            </div>
          ) : (
            <>
              {(view === "overview" || view === "parcels") && (
                <section
                  className="stats-grid"
                  aria-label="Statystyki przesyłek"
                >
                  {[
                    {
                      label: "Wszystkie przesyłki",
                      value: parcels.length,
                      icon: Package,
                      note: "w Twojej przestrzeni",
                      status: "ALL",
                      color: "green",
                    },
                    {
                      label: "W drodze",
                      value: counts.IN_TRANSIT + counts.OUT_FOR_DELIVERY,
                      icon: Truck,
                      note: `${counts.OUT_FOR_DELIVERY} w doręczeniu`,
                      status: "IN_TRANSIT",
                      color: "blue",
                    },
                    {
                      label: "Doręczone",
                      value: counts.DELIVERED,
                      icon: PackageCheck,
                      note: "bezpiecznie u odbiorcy",
                      status: "DELIVERED",
                      color: "mint",
                    },
                    {
                      label: "Do nadania",
                      value: counts.CREATED,
                      icon: Box,
                      note: "czekają na swoją podróż",
                      status: "CREATED",
                      color: "amber",
                    },
                  ].map(({ label, value, icon: Icon, note, status, color }) => (
                    <button
                      className="stat-card"
                      key={label}
                      onClick={() => {
                        go("parcels");
                        setFilter(status as Status | "ALL");
                      }}
                    >
                      <div className="stat-top">
                        <span>{label}</span>
                        <span className={`stat-icon ${color}`}>
                          <Icon size={19} />
                        </span>
                      </div>
                      <strong className="stat-value">
                        {String(value).padStart(2, "0")}
                      </strong>
                      <div className="stat-bottom">
                        <span className={`stat-dot ${color}`} />
                        {note}
                        <ArrowUpRight size={15} />
                      </div>
                    </button>
                  ))}
                </section>
              )}
              {view === "overview" && (
                <section className="overview-grid">
                  <div className="chart-panel">
                    <div className="section-heading">
                      <div>
                        <h2>Aktywność przesyłek</h2>
                        <p>Małe paczki, wielkie podróże.</p>
                      </div>
                      <label className="period-select">
                        <CalendarDays size={14} />
                        <select
                          aria-label="Okres statystyk"
                          value={period}
                          onChange={(event) => setPeriod(event.target.value)}
                        >
                          <option value="7">Ostatnie 7 dni</option>
                          <option value="14">Ostatnie 14 dni</option>
                        </select>
                        <ChevronDown size={12} />
                      </label>
                    </div>
                    <div className="chart-summary">
                      <strong>
                        {days.reduce((sum, day) => sum + day.sent, 0)}
                        <span>przesyłek</span>
                      </strong>
                      <div className="chart-legend">
                        <span>
                          <i />
                          Nadane
                        </span>
                        <span>
                          <i />
                          Doręczone
                        </span>
                      </div>
                    </div>
                    <div className="chart">
                      <div className="chart-y">
                        {[
                          chartMax,
                          Math.round(chartMax * 0.75),
                          Math.round(chartMax * 0.5),
                          Math.round(chartMax * 0.25),
                          0,
                        ].map((value, index) => (
                          <span key={index}>{value}</span>
                        ))}
                      </div>
                      <div className="chart-area">
                        <div className="chart-lines">
                          {[0, 1, 2, 3, 4].map((item) => (
                            <i key={item} />
                          ))}
                        </div>
                        <div className="chart-columns">
                          {days.map(({ day, sent, delivered }) => (
                            <div
                              className="chart-column"
                              key={day.toISOString()}
                            >
                              <div
                                className="bar-pair"
                                title={`${date(day.toISOString())}: ${sent} nadanych, ${delivered} doręczonych`}
                              >
                                <div
                                  className="bar sent"
                                  style={{
                                    height: `${(sent / chartMax) * 100}%`,
                                  }}
                                />
                                <div
                                  className="bar delivered"
                                  style={{
                                    height: `${(delivered / chartMax) * 100}%`,
                                  }}
                                />
                              </div>
                              <span>
                                {day.toLocaleDateString("pl-PL", {
                                  day: "2-digit",
                                  month: "2-digit",
                                })}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  <aside className="pickup-panel">
                    <div className="pickup-photo">
                      <Image
                        src="https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=800&q=85"
                        alt="Kartonowa przesyłka przygotowana do nadania"
                        width={800}
                        height={300}
                        unoptimized
                        loading="eager"
                      />
                      <span>
                        <i />
                        GOTOWE DO DROGI
                      </span>
                    </div>
                    <div className="pickup-body">
                      <span className="pickup-kicker">NASTĘPNY KROK</span>
                      <h2>
                        {nextParcel
                          ? "Twoja paczka czeka na start."
                          : "Wszystkie paczki w drodze."}
                      </h2>
                      <p>
                        {nextParcel ? (
                          <>
                            Przesyłka do <strong>{nextParcel.city}</strong> jest
                            już gotowa do nadania.
                          </>
                        ) : (
                          "Nowa podróż zaczyna się od jednej przesyłki."
                        )}
                      </p>
                      <button
                        className="text-button"
                        onClick={() =>
                          nextParcel
                            ? openParcel(nextParcel)
                            : setCreateOpen(true)
                        }
                      >
                        {nextParcel ? "Zobacz przesyłkę" : "Nadaj nową paczkę"}
                        <ArrowUpRight size={17} />
                      </button>
                    </div>
                  </aside>
                </section>
              )}
              {(view === "overview" || view === "parcels") && (
                <section className="shipments-section">
                  <div className="section-heading">
                    <div className="title-with-count">
                      <h2>
                        {view === "overview"
                          ? "Ostatnie przesyłki"
                          : "Lista przesyłek"}
                      </h2>
                      <span>{parcels.length}</span>
                    </div>
                    <button
                      className="button secondary small"
                      onClick={exportCsv}
                    >
                      <Download size={15} />
                      Eksportuj<span className="desktop-only"> CSV</span>
                    </button>
                  </div>
                  <div className="table-controls">
                    <div
                      className="filter-tabs"
                      role="tablist"
                      aria-label="Status przesyłek"
                    >
                      {(
                        ["ALL", "IN_TRANSIT", "DELIVERED", "CREATED"] as const
                      ).map((status) => (
                        <button
                          key={status}
                          role="tab"
                          aria-selected={filter === status}
                          className={filter === status ? "selected" : ""}
                          onClick={() => {
                            setFilter(status);
                            setPage(1);
                          }}
                        >
                          {status === "ALL" ? "Wszystkie" : statusNames[status]}
                          <span>
                            {status === "ALL" ? parcels.length : counts[status]}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="table-search">
                      <Search size={16} />
                      <input
                        aria-label="Szukaj przesyłki"
                        placeholder="Szukaj przesyłki…"
                        value={search}
                        onChange={(event) => {
                          setSearch(event.target.value);
                          setPage(1);
                        }}
                      />
                      {search && (
                        <button
                          className="icon-button"
                          aria-label="Wyczyść wyszukiwanie"
                          onClick={() => setSearch("")}
                        >
                          <X size={14} />
                        </button>
                      )}
                      <label className="status-select" title="Wybierz status">
                        <SlidersHorizontal size={16} />
                        <select
                          aria-label="Filtr statusu"
                          value={filter}
                          onChange={(event) => {
                            setFilter(event.target.value as Status | "ALL");
                            setPage(1);
                          }}
                        >
                          <option value="ALL">Wszystkie</option>
                          {statusOrder.map((status) => (
                            <option key={status} value={status}>
                              {statusNames[status]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>
                            Numer przesyłki <ArrowDown size={12} />
                          </th>
                          <th>Odbiorca</th>
                          <th>Status</th>
                          <th>Data nadania</th>
                          <th>Przesyłka</th>
                          <th aria-label="Akcje" />
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((parcel) => (
                          <tr
                            key={parcel.id}
                            onClick={() => openParcel(parcel)}
                          >
                            <td>
                              <div className="tracking-cell">
                                <span className="parcel-symbol">
                                  <Package size={18} />
                                </span>
                                <span>
                                  <strong>{parcel.trackingNumber}</strong>
                                  <small>
                                    {parcel.service === "EXPRESS"
                                      ? "Przesyłka ekspresowa"
                                      : "Przesyłka standardowa"}
                                  </small>
                                </span>
                              </div>
                            </td>
                            <td>
                              <strong className="recipient-name">
                                {parcel.recipientName}
                              </strong>
                              <span className="city-cell">
                                <MapPin size={11} />
                                {parcel.city}
                              </span>
                            </td>
                            <td>
                              <Badge status={parcel.status} />
                            </td>
                            <td className="date-cell">
                              {date(parcel.createdAt)}
                              <small>{time(parcel.createdAt)}</small>
                            </td>
                            <td>
                              <span className="size-cell">{parcel.size}</span>
                              <span className="weight-cell">
                                {parcel.weight} kg
                              </span>
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                aria-label={`Szczegóły ${parcel.trackingNumber}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openParcel(parcel);
                                }}
                              >
                                <MoreHorizontal size={19} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {visible.length === 0 && (
                      <div className="empty-state">
                        <Package size={30} />
                        <h3>
                          {search || filter !== "ALL"
                            ? "Brak pasujących przesyłek"
                            : "Twoja pierwsza paczka czeka"}
                        </h3>
                        <p>
                          {search || filter !== "ALL"
                            ? "Zmień wyszukiwanie lub wybierz inny status."
                            : "Nadane przesyłki pojawią się w tym miejscu."}
                        </p>
                        <button
                          className="button secondary"
                          onClick={() => {
                            if (search || filter !== "ALL") {
                              setFilter("ALL");
                              setSearch("");
                            } else setCreateOpen(true);
                          }}
                        >
                          {search || filter !== "ALL"
                            ? "Wyczyść filtry"
                            : "Nadaj przesyłkę"}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="table-footer">
                    <span>
                      Wyświetlono{" "}
                      <strong>
                        {filtered.length
                          ? (Math.min(page, pageCount) - 1) * pageSize + 1
                          : 0}
                        –
                        {Math.min(
                          Math.min(page, pageCount) * pageSize,
                          filtered.length,
                        )}
                      </strong>{" "}
                      z <strong>{filtered.length}</strong> przesyłek
                    </span>
                    {view === "overview" ? (
                      <button
                        className="text-button"
                        onClick={() => go("parcels")}
                      >
                        Wszystkie przesyłki
                        <ArrowRight size={15} />
                      </button>
                    ) : (
                      <div className="pagination">
                        <button
                          className="icon-button"
                          aria-label="Poprzednia strona"
                          disabled={page <= 1}
                          onClick={() => setPage(page - 1)}
                        >
                          <ChevronLeft size={17} />
                        </button>
                        <span>
                          {Math.min(page, pageCount)} / {pageCount}
                        </span>
                        <button
                          className="icon-button"
                          aria-label="Następna strona"
                          disabled={page >= pageCount}
                          onClick={() => setPage(page + 1)}
                        >
                          <ChevronRight size={17} />
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              )}
              {view === "overview" && (
                <div className="bottom-strip">
                  <div>
                    <span className="strip-icon">
                      <ShieldCheck size={20} />
                    </span>
                    <span>
                      <strong>Spokojna głowa. Bezpieczna przesyłka.</strong>
                      <small>
                        Twoje dane są szyfrowane, a odbiór potwierdzony kodem.
                      </small>
                    </span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => go("settings")}
                  >
                    Bezpieczeństwo konta
                    <ArrowUpRight size={15} />
                  </button>
                </div>
              )}
              {view === "tracking" && (
                <section className="tracking-page">
                  <form className="tracking-form" onSubmit={track}>
                    <span className="large-icon">
                      <Route size={25} />
                    </span>
                    <h2>Śledź swoją przesyłkę</h2>
                    <div className="tracking-input">
                      <Search size={20} />
                      <input
                        aria-label="Numer śledzenia"
                        value={trackNumber}
                        onChange={(event) => setTrackNumber(event.target.value)}
                        placeholder="Wpisz numer przesyłki, np. PK202610170001"
                        required
                        maxLength={24}
                      />
                      <button className="button primary" disabled={busy}>
                        {busy ? (
                          <LoaderCircle className="spin" size={17} />
                        ) : (
                          <ArrowRight size={18} />
                        )}
                        <span>Sprawdź</span>
                      </button>
                    </div>
                    {trackError && (
                      <p className="field-error" role="alert">
                        {trackError}
                      </p>
                    )}
                  </form>
                  {tracking &&
                    linkedTrackingNumber === tracking.trackingNumber && (
                    <div className="tracking-result">
                      <div className="section-heading">
                        <div>
                          <span className="eyebrow">TWOJA PRZESYŁKA</span>
                          <h2 className="mono">{tracking.trackingNumber}</h2>
                        </div>
                        <Badge status={tracking.status} />
                      </div>
                      <div className="tracking-destination">
                        <MapPin size={22} />
                        <div>
                          <small>Miasto docelowe</small>
                          <strong>{tracking.city}</strong>
                        </div>
                        <div>
                          <small>Przewidywane doręczenie</small>
                          <strong>
                            {date(tracking.estimatedDelivery, true)}
                          </strong>
                        </div>
                      </div>
                      <Timeline history={tracking.history} />
                    </div>
                  )}
                  <div className="privacy-line">
                    <LockKeyhole size={15} />
                    Publiczne śledzenie nie ujawnia danych odbiorcy.
                  </div>
                </section>
              )}
              {view === "users" && role === "ADMIN" && !demo && (
                <section className="shipments-section">
                  <div className="section-heading">
                    <div className="title-with-count">
                      <h2>Lista użytkowników</h2>
                      <span>{filteredManagedUsers.length}</span>
                    </div>
                    <button
                      className="button primary small"
                      onClick={() => setCreateUserOpen(true)}
                    >
                      <Plus size={15} /> Dodaj konto
                    </button>
                  </div>
                  <div className="table-controls">
                    <div
                      className="filter-tabs"
                      role="tablist"
                      aria-label="Filtruj użytkowników po roli"
                    >
                      {([
                        ["ALL", "Wszyscy"],
                        ["CLIENT", "Klienci"],
                        ["COURIER", "Kurierzy"],
                        ["ADMIN", "Administratorzy"],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          role="tab"
                          aria-selected={userRoleFilter === value}
                          className={userRoleFilter === value ? "selected" : ""}
                          onClick={() => setUserRoleFilter(value)}
                        >
                          {label}
                          <span>
                            {value === "ALL"
                              ? managedUsers.length
                              : managedUsers.filter((user) => user.role === value).length}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="table-search">
                      <Search size={16} />
                      <input
                        aria-label="Szukaj użytkownika"
                        placeholder="Szukaj po adresie e-mail…"
                        value={userSearch}
                        onChange={(event) => setUserSearch(event.target.value)}
                      />
                      {userSearch && (
                        <button
                          className="icon-button"
                          aria-label="Wyczyść wyszukiwanie użytkowników"
                          onClick={() => setUserSearch("")}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Adres e-mail</th>
                          <th>Rola</th>
                          <th>Weryfikacja 2FA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredManagedUsers.map((user) => (
                          <tr key={user.id}>
                            <td>
                              <strong className="recipient-name">{user.email}</strong>
                            </td>
                            <td>{roleNames[user.role]}</td>
                            <td>
                              <span className="security-tag">
                                {user.is2faEnabled ? "Aktywna" : "Nieaktywna"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filteredManagedUsers.length === 0 && (
                      <div className="empty-state">
                        <Users size={28} />
                        <h3>Brak użytkowników dla tego filtra</h3>
                        <p>Dodaj konto klienta lub kuriera, aby rozpocząć.</p>
                      </div>
                    )}
                  </div>
                  <div className="table-footer">
                    Konta: <strong>{filteredManagedUsers.length}</strong>
                  </div>
                </section>
              )}
              {view === "reports" && (
                <section className="reports-page">
                  <div className="report-banner">
                    <span className="large-icon">
                      <ChartNoAxesCombined size={25} />
                    </span>
                    <div>
                      <span className="eyebrow">PODSUMOWANIE WYSYŁEK</span>
                      <h2>{money(totalCost)}</h2>
                      <p>Łączna wycena {parcels.length} przesyłek</p>
                    </div>
                    <button className="button secondary" onClick={exportCsv}>
                      <Download size={16} />
                      Pobierz raport
                    </button>
                  </div>
                  <div className={paymentStyles.summary}>
                    <div className={paymentStyles.summaryItem}>
                      <span>Opłacono</span>
                      <strong>{money(paidTotal)}</strong>
                    </div>
                    <div className={paymentStyles.summaryItem}>
                      <span>Do zapłaty</span>
                      <strong>{money(unpaidTotal)}</strong>
                    </div>
                  </div>
                  <div className="report-grid">
                    {statusOrder.map((status) => (
                      <div className="report-row" key={status}>
                        <Badge status={status} />
                        <strong>{counts[status]}</strong>
                        <span>
                          {money(
                            parcels
                              .filter((parcel) => parcel.status === status)
                              .reduce((sum, parcel) => sum + parcel.price, 0),
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className={paymentStyles.note}>
                    Płatności są symulowane lokalnie; nie są pobierane prawdziwe
                    środki ani dane karty.
                  </p>
                </section>
              )}
              {view === "settings" && (
                <section className="settings-page">
                  <div className="settings-profile">
                    <span className="profile-avatar large">AK</span>
                    <div>
                      <h2>{demo ? "Aleksandra Kowalska" : "Moje konto"}</h2>
                      <p>{roleNames[role]}</p>
                    </div>
                    {token.current && (
                      <button
                        className="button secondary"
                        onClick={async () => {
                          try {
                            await api("/auth/logout", { method: "POST" });
                            window.sessionStorage.removeItem("demo-role");
                            token.current = "";
                            setParcels([]);
                            setLoginOpen(true);
                          } catch (error) {
                            setToast((error as Error).message);
                          }
                        }}
                      >
                        <LogOut size={16} />
                        Wyloguj
                      </button>
                    )}
                  </div>
                  {demo && (
                    <div className="settings-block">
                      <div>
                        <h3>Aktywny panel</h3>
                        <p>Wybierz widok klienta, kuriera lub administratora.</p>
                      </div>
                      <label className="role-select">
                        <select
                          aria-label="Rola konta"
                          value={role}
                          onChange={(event) =>
                            switchRole(event.target.value as Role)
                          }
                        >
                          {Object.entries(roleNames).map(([value, label]) => (
                            <option value={value} key={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={15} />
                      </label>
                    </div>
                  )}
                  <div className="settings-block">
                    <span className="large-icon">
                      <Mail size={22} />
                    </span>
                    <div>
                      <h3>Powiadomienia e-mail</h3>
                      <p>
                        {emailReady
                          ? "SMTP skonfigurowane. PIN i zmiany statusu są wysyłane odbiorcy."
                          : emailConfigured
                            ? "Serwer SMTP odrzuca logowanie. Sprawdź login i klucz SMTP."
                            : "Dodaj dane serwera SMTP do .env, aby wysyłać PIN i zmiany statusu."}
                      </p>
                    </div>
                    <span className="security-tag">
                      {emailReady
                        ? "Aktywne"
                        : emailConfigured
                          ? "Błąd logowania"
                          : "Wymaga konfiguracji"}
                    </span>
                  </div>
                  <div className="settings-block">
                    <span className="large-icon">
                      <ShieldCheck size={23} />
                    </span>
                    <div>
                      <h3>Weryfikacja dwuetapowa</h3>
                      <p>
                        {demo
                          ? "Konfiguracja dostępna po zalogowaniu do konta użytkownika."
                          : twoFactorEnabled
                            ? "Kody z aplikacji authenticator są wymagane przy logowaniu."
                            : "Dodaj kod QR do aplikacji authenticator przy logowaniu."}
                      </p>
                    </div>
                    <span className="security-tag">
                      {demo
                        ? "Niedostępne"
                        : twoFactorEnabled
                          ? "Aktywne"
                          : "Nieaktywne"}
                    </span>
                  </div>
                  {!demo && twoFactorEnabled && (
                    <form
                      className="security-form"
                      onSubmit={disableTwoFactor}
                    >
                      <label>
                        Potwierdź hasłem
                        <input
                          name="password"
                          type="password"
                          autoComplete="current-password"
                          required
                        />
                      </label>
                      <label>
                        Aktualny kod z aplikacji
                        <input
                          name="code"
                          inputMode="numeric"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          autoComplete="one-time-code"
                          required
                        />
                      </label>
                      <button className="button secondary" disabled={busy}>
                        {busy ? "Odłączanie…" : "Odłącz 2FA"}
                      </button>
                    </form>
                  )}
                  {!demo && !twoFactorEnabled && (
                    <form
                      className="security-form"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const data = new FormData(event.currentTarget);
                        try {
                          if (!setup) {
                            const configuration = await api<{
                              secret: string;
                              uri: string;
                            }>("/auth/2fa/setup", {
                                method: "POST",
                                body: JSON.stringify({
                                  password: data.get("password"),
                                }),
                              });
                            const qrCode = await QRCode.toDataURL(
                              configuration.uri,
                              { errorCorrectionLevel: "M", margin: 1, width: 220 },
                            );
                            setSetup({ ...configuration, qrCode });
                          } else {
                            await api("/auth/2fa/enable", {
                              method: "POST",
                              body: JSON.stringify({ code: data.get("code") }),
                            });
                            setTwoFactorEnabled(true);
                            setSetup(null);
                            setToast(
                              "Weryfikacja dwuetapowa została włączona.",
                            );
                          }
                        } catch (error) {
                          setToast((error as Error).message);
                        }
                      }}
                    >
                      {setup ? (
                        <>
                          <label>
                            Zeskanuj kod QR w aplikacji authenticator
                            <Image
                              className={styles.qr}
                              src={setup.qrCode}
                              alt="Kod QR konfiguracji weryfikacji dwuetapowej"
                              width={220}
                              height={220}
                              unoptimized
                            />
                          </label>
                          <label>
                            Klucz do ręcznej konfiguracji
                            <code className="totp-secret">{setup.secret}</code>
                          </label>
                          <label>
                            Kod weryfikacyjny
                            <input
                              name="code"
                              inputMode="numeric"
                              pattern="[0-9]{6}"
                              maxLength={6}
                              required
                              autoComplete="one-time-code"
                            />
                          </label>
                        </>
                      ) : (
                        <label>
                          Potwierdź hasłem
                          <input
                            name="password"
                            type="password"
                            autoComplete="current-password"
                            required
                          />
                        </label>
                      )}
                      <button className="button primary">
                        <ShieldCheck size={16} />
                        {setup ? "Włącz 2FA" : "Skonfiguruj 2FA"}
                      </button>
                    </form>
                  )}
                  <div className="settings-block">
                    <LockKeyhole size={22} />
                    <div>
                      <h3>Prywatność danych</h3>
                      <p>
                        Adresy i numery telefonów są szyfrowane. Dostęp do
                        danych jest ograniczony uprawnieniami.
                      </p>
                    </div>
                    <span className="security-tag">
                      <Check size={13} />
                      AES-256-GCM
                    </span>
                  </div>
                  {role === "ADMIN" && (
                    <button
                      className="button secondary"
                      onClick={async () => {
                        try {
                          const logs = await api<unknown[]>("/admin/audit");
                          const url = URL.createObjectURL(
                            new Blob([JSON.stringify(logs, null, 2)], {
                              type: "application/json",
                            }),
                          );
                          const anchor = document.createElement("a");
                          anchor.href = url;
                          anchor.download = "audit.json";
                          anchor.click();
                          URL.revokeObjectURL(url);
                          setToast(
                            demo
                              ? "Rejestr audytowy nie zawiera wpisów."
                              : "Pobrano rejestr audytowy.",
                          );
                        } catch (error) {
                          setToast((error as Error).message);
                        }
                      }}
                    >
                      <Download size={16} />
                      Pobierz rejestr audytowy
                    </button>
                  )}
                </section>
              )}
            </>
          )}
          <footer className="main-footer">
            <span>
              © {new Date().getFullYear()} przesyłka. Dobrze dostarczone.
            </span>
            <span>
              <i />
              Panel przesyłek
              <span className="footer-dot">·</span>Polska{" "}
              <ChevronDown size={11} />
            </span>
          </footer>
        </main>
      </div>
      {createOpen && (
        <Modal
          title="Nadaj nową przesyłkę"
          subtitle="Nowa podróż zaczyna się tutaj."
          onClose={() => setCreateOpen(false)}
        >
          <ParcelForm
            busy={busy}
            onSubmit={createParcel}
            onCancel={() => setCreateOpen(false)}
          />
        </Modal>
      )}
      {createUserOpen && (
        <Modal
          title="Dodaj konto użytkownika"
          subtitle="Utwórz konto klienta lub kuriera."
          onClose={() => setCreateUserOpen(false)}
        >
          <form className={settingsStyles.userForm} onSubmit={createManagedUser}>
            <label>
              Imię i nazwisko
              <input
                name="fullName"
                minLength={3}
                maxLength={120}
                autoComplete="name"
                required
              />
            </label>
            <label>
              Adres e-mail
              <input
                name="email"
                type="email"
                maxLength={254}
                autoComplete="email"
                required
              />
            </label>
            <label>
              Rola
              <select name="role" defaultValue="CLIENT" required>
                <option value="CLIENT">Panel klienta</option>
                <option value="COURIER">Panel kuriera</option>
              </select>
            </label>
            <label>
              Hasło początkowe
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={200}
                autoComplete="new-password"
                required
              />
            </label>
            <div className="modal-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setCreateUserOpen(false)}
              >
                Anuluj
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? "Tworzenie…" : "Utwórz konto"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {selected && detailTrackingNumber && (
        <Modal
          title="Szczegóły przesyłki"
          subtitle={selected.trackingNumber}
          onClose={closeParcel}
        >
          <div className="parcel-detail">
            <div className="detail-status">
              <Badge status={selected.status} />
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      selected.trackingNumber,
                    );
                    setToast("Numer przesyłki skopiowany.");
                  } catch {
                    setToast("Kopiowanie jest niedostępne w tej przeglądarce.");
                  }
                }}
              >
                <Copy size={14} />
                Kopiuj numer
              </button>
            </div>
            <div className="address-label">
              <span className="label-brand">przesyłka.</span>
              <span className="label-service">
                {selected.service === "EXPRESS" ? "EXPRESS" : "STANDARD"} /{" "}
                {selected.size}
              </span>
              <h3>{selected.recipientName}</h3>
              <p>
                {selected.recipientAddress}
                <br />
                {selected.postalCode} {selected.city}
              </p>
              <span>{selected.recipientPhone}</span>
              <div className="label-tracking">{selected.trackingNumber}</div>
              {labelQr && (
                <Image
                  className={labelStyles.trackingQr}
                  src={labelQr}
                  alt={`Kod QR do śledzenia przesyłki ${selected.trackingNumber}`}
                  width={180}
                  height={180}
                  unoptimized
                />
              )}
            </div>
            <div className="detail-facts">
              <div>
                <small>Waga</small>
                <strong>{selected.weight} kg</strong>
              </div>
              <div>
                <small>Wycena</small>
                <strong>{money(selected.price)}</strong>
              </div>
              <div>
                <small>Przewidywane doręczenie</small>
                <strong>{date(selected.estimatedDelivery)}</strong>
              </div>
            </div>
            <div className={paymentStyles.detail}>
              <div className={paymentStyles.detailHeading}>
                <strong>Płatność · {money(selected.price)}</strong>
                <span
                  className={
                    selected.paymentStatus === "PAID"
                      ? paymentStyles.paid
                      : paymentStyles.unpaid
                  }
                >
                  {selected.paymentStatus === "PAID" ? "Opłacona" : "Do zapłaty"}
                </span>
              </div>
              {selected.paymentStatus === "UNPAID" &&
                (role === "CLIENT" || role === "ADMIN") && (
                  <button
                    className="button primary"
                    onClick={simulatePayment}
                    disabled={busy}
                  >
                    {busy ? "Przetwarzanie…" : `Opłać testowo · ${money(selected.price)}`}
                  </button>
                )}
              <p className={paymentStyles.note}>
                Symulacja edukacyjna — nie pobiera prawdziwych pieniędzy ani
                danych karty.
              </p>
            </div>
            {selected.demoPickupCode && (
              <div className="demo-pin">
                Kod odbioru:{" "}
                <strong>{selected.demoPickupCode}</strong>
              </div>
            )}
            <h3 className="timeline-heading">Historia przesyłki</h3>
            <Timeline history={selected.history} />
            {role !== "CLIENT" && selected.status !== "DELIVERED" && (
              <form className="status-form" onSubmit={changeStatus}>
                {selected.status === "OUT_FOR_DELIVERY" && (
                  <label>
                    Kod odbioru od odbiorcy
                    <input
                      name="pin"
                      placeholder="6-cyfrowy kod"
                      pattern="[0-9]{6}"
                      inputMode="numeric"
                      maxLength={6}
                      required
                      autoComplete="one-time-code"
                    />
                  </label>
                )}
                {selected.status === "IN_TRANSIT" &&
                  !demo &&
                  role === "ADMIN" && (
                  <label>
                    Przypisz kuriera
                    <select name="courier" required defaultValue="">
                      <option value="" disabled>
                        Wybierz konto kuriera
                      </option>
                      {managedUsers
                        .filter((user) => user.role === "COURIER")
                        .map((user) => (
                          <option value={user.id} key={user.id}>
                            {user.email}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <button className="button primary" disabled={busy}>
                  <CheckCheck size={17} />
                  {busy
                    ? "Zapisywanie…"
                    : selected.status === "OUT_FOR_DELIVERY"
                      ? "Potwierdź doręczenie"
                      : `Zmień: ${statusNames[statusOrder[statusOrder.indexOf(selected.status) + 1]]}`}
                </button>
              </form>
            )}
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => window.print()}
              >
                <Printer size={16} />
                Etykieta adresowa
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setTrackNumber(selected.trackingNumber);
                  setTracking(selected);
                  setSelected(null);
                  router.push(
                    `/tracking/${encodeURIComponent(selected.trackingNumber)}`,
                  );
                }}
              >
                <Route size={16} />
                Śledź przesyłkę
              </button>
            </div>
          </div>
        </Modal>
      )}
      {loginOpen && (
        <Modal
          title={authStep ? "Potwierdź, że to Ty" : "Witaj w przesyłka."}
          subtitle={
            authStep
              ? "Wprowadź kod z aplikacji uwierzytelniającej."
              : "Zaloguj się do swojej przestrzeni."
          }
          onClose={() => {
            if (token.current) setLoginOpen(false);
          }}
        >
          <form className="login-form" onSubmit={login}>
            {authStep ? (
              <label>
                Kod uwierzytelniający
                <input
                  name="code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                  autoFocus
                />
              </label>
            ) : (
              <>
                <label>
                  Adres email
                  <input
                    name="email"
                    type="email"
                    autoComplete="username"
                    required
                  />
                </label>
                <label>
                  Hasło
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
              </>
            )}
            <button className="button primary" disabled={busy}>
              <LockKeyhole size={17} />
              {busy
                ? "Weryfikacja…"
                : authStep
                  ? "Potwierdź kod"
                  : "Zaloguj się"}
            </button>
            {demo && (
              <button
                type="button"
                className="text-button"
                onClick={async () => {
                  await switchRole("CLIENT");
                  setLoginOpen(false);
                }}
              >
                Wróć do panelu klienta
                <ArrowRight size={15} />
              </button>
            )}
          </form>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>
            <CircleHelp size={18} />
          </span>
          {toast}
          <button
            className="icon-button"
            aria-label="Zamknij powiadomienie"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function Timeline({ history }: { history: History[] }) {
  return (
    <ol className="timeline">
      {[...history].reverse().map((event, index) => (
        <li
          key={`${event.timestamp}-${index}`}
          className={index === 0 ? "current" : ""}
        >
          <span className="timeline-marker">
            {index === 0 ? <PackageCheck size={15} /> : <Check size={12} />}
          </span>
          <div>
            <strong>{statusNames[event.status]}</strong>
            <span>{event.location}</span>
          </div>
          <time>
            {date(event.timestamp)}
            <small>{time(event.timestamp)}</small>
          </time>
        </li>
      ))}
    </ol>
  );
}
function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("input,button,select")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = dialog.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]),input,select,a[href]",
      );
      if (!items?.length) return;
      const firstItem = items[0],
        lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={dialog}
      >
        <div className="modal-heading">
          <div>
            <h2 id="modal-title">{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button
            className="icon-button"
            aria-label="Zamknij okno"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function ParcelForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const [size, setSize] = useState("M");
  const [service, setService] = useState("STANDARD");
  const price =
    { S: 1490, M: 1890, L: 2490 }[size as "S" | "M" | "L"] +
    (service === "EXPRESS" ? 1000 : 0);
  return (
    <form className="parcel-form" onSubmit={onSubmit}>
      <span className="form-section-title">
        <span>01</span>Dane odbiorcy
      </span>
      <label>
        Imię i nazwisko
        <input
          name="name"
          placeholder="np. Anna Nowak"
          minLength={3}
          maxLength={120}
          required
          autoComplete="name"
        />
      </label>
      <label>
        Numer telefonu
        <input
          name="phone"
          type="tel"
          placeholder="+48 500 600 700"
          pattern="\+?[0-9\s\(\)\-]{9,20}"
          required
          autoComplete="tel"
        />
      </label>
      <label>
        Adres e-mail odbiorcy
        <input
          name="email"
          type="email"
          placeholder="np. anna@example.com"
          maxLength={254}
          required
          autoComplete="email"
        />
      </label>
      <label>
        Ulica i numer
        <input
          name="address"
          placeholder="np. ul. Dobra 12/4"
          minLength={5}
          maxLength={240}
          required
          autoComplete="street-address"
        />
      </label>
      <div className="form-row">
        <label>
          Kod pocztowy
          <input
            name="postal"
            placeholder="00-001"
            pattern="[0-9]{2}-[0-9]{3}"
            required
            autoComplete="postal-code"
          />
        </label>
        <label>
          Miasto
          <input
            name="city"
            placeholder="Warszawa"
            minLength={2}
            maxLength={80}
            required
            autoComplete="address-level2"
          />
        </label>
      </div>
      <span className="form-section-title">
        <span>02</span>Twoja przesyłka
      </span>
      <div className="size-options">
        {[
          { value: "S", label: "Mała", dimensions: "8 × 38 × 64 cm" },
          { value: "M", label: "Średnia", dimensions: "19 × 38 × 64 cm" },
          { value: "L", label: "Duża", dimensions: "41 × 38 × 64 cm" },
        ].map((item) => (
          <label
            key={item.value}
            className={size === item.value ? "chosen" : ""}
          >
            <input
              type="radio"
              name="size"
              value={item.value}
              checked={size === item.value}
              onChange={() => setSize(item.value)}
            />
            <Package
              size={item.value === "S" ? 20 : item.value === "M" ? 25 : 30}
            />
            <strong>
              {item.label} <span>{item.value}</span>
            </strong>
            <small>{item.dimensions}</small>
          </label>
        ))}
      </div>
      <div className="form-row">
        <label>
          Waga (kg)
          <input
            name="weight"
            type="number"
            min="0.1"
            max="25"
            step="0.1"
            defaultValue="1"
            required
          />
        </label>
        <label>
          Usługa
          <select
            name="service"
            value={service}
            onChange={(event) => setService(event.target.value)}
          >
            <option value="STANDARD">Standard · 2 dni</option>
            <option value="EXPRESS">Express · 1 dzień</option>
          </select>
        </label>
      </div>
      <div className="form-price">
        <span>
          Wycena przesyłki<small>Szacunkowa kwota przesyłki</small>
        </span>
        <strong>{money(price)}</strong>
      </div>
      <div className="modal-footer">
        <button type="button" className="button secondary" onClick={onCancel}>
          Anuluj
        </button>
        <button className="button primary" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Plus size={17} />
          )}
          {busy ? "Tworzenie…" : "Utwórz przesyłkę"}
        </button>
      </div>
    </form>
  );
}
