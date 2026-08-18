/** HouseholdContext — loads current household + members + pending state. */
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiGet } from "./api";
import { setCurrency } from "./ui";
import { useAuth, AppUser } from "./auth";

export type Household = {
  household_id: string;
  name: string;
  invite_code: string;
  created_by: string;
  member_ids: string[];
  pending_member_ids?: string[];
  current_period_id: string;
  /** Evin kurulduğu an — ay seçici bundan öncesine inmiyor. */
  created_at?: string;
  /** Bir ev = bir para birimi. Karisirsa toplama islemi anlamsizlasir. */
  country?: "DE" | "TR";
  currency?: "EUR" | "TRY";
};
export type Period = {
  period_id: string;
  household_id: string;
  started_at: string;
  closed_at: string | null;
  status: "active" | "closed";
};
export type PendingHouseholdRef = { household_id: string; name: string };

type Ctx = {
  household: Household | null;
  members: AppUser[];
  pendingMembers: AppUser[];
  pendingHousehold: PendingHouseholdRef | null; // when *I* am waiting
  activePeriod: Period | null;
  adminId: string | null;
  isAdmin: boolean;
  /** Household expenses already in the open period — approving a new member
   *  re-splits all of them, so the approval UI warns when this is non-zero. */
  openExpenseCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
};

const HH = createContext<Ctx>({} as any);
export const useHousehold = () => useContext(HH);

export function HouseholdProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<AppUser[]>([]);
  const [pendingMembers, setPendingMembers] = useState<AppUser[]>([]);
  const [pendingHousehold, setPendingHousehold] = useState<PendingHouseholdRef | null>(null);
  const [activePeriod, setActivePeriod] = useState<Period | null>(null);
  const [adminId, setAdminId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [openExpenseCount, setOpenExpenseCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setHousehold(null); setMembers([]); setPendingMembers([]);
      setPendingHousehold(null); setActivePeriod(null);
      setAdminId(null); setIsAdmin(false); setOpenExpenseCount(0);
      setLoading(false);
      return;
    }
    // No setLoading(true) here: refresh() also runs on every screen focus, and
    // flipping loading would flash the full-screen spinner over live content.
    try {
      const res = await apiGet<any>("/households/me");
      setHousehold(res.household || null);
      // Para birimi biçimleyiciye burada bağlanıyor: formatEUR yüzlerce yerde
      // bağlam almadan çağrılıyor, ev nesnesini oralara taşımak mümkün değil.
      setCurrency(res.household?.currency);
      setMembers(res.members || []);
      setPendingMembers(res.pending_members || []);
      setPendingHousehold(res.pending_household || null);
      setActivePeriod(res.active_period || null);
      setAdminId(res.admin_id || null);
      setIsAdmin(!!res.is_admin);
      setOpenExpenseCount(res.open_expense_count || 0);
    } catch (e) { console.log("household refresh failed", e); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <HH.Provider value={{ household, members, pendingMembers, pendingHousehold, activePeriod, adminId, isAdmin, openExpenseCount, loading, refresh }}>
      {children}
    </HH.Provider>
  );
}
