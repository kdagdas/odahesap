/** Settings — profile (with avatar picker), household + invite code, pending approvals, member list, leave/logout. */
import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Share, Platform, ActivityIndicator, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import { apiPost, api } from "@/src/api";
import { Avatar, Card } from "@/src/ui";
import { colors, spacing, radius, font, AVATARS } from "@/src/theme";

export default function Settings() {
  const router = useRouter();
  const { user, logout, refresh: refreshAuth } = useAuth();
  const { household, members, pendingMembers, isAdmin, adminId, refresh } = useHousehold();
  const [busy, setBusy] = useState<string | null>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [transferTo, setTransferTo] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Join requests land while the app is already open — without re-fetching on
  // focus, the admin never sees them until a full restart.
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const saveName = async () => {
    const next = nameDraft.trim();
    if (!next) { setMessage("Ev adı boş olamaz"); return; }
    setSavingName(true); setMessage(null);
    try {
      await api("/households", { method: "PATCH", body: JSON.stringify({ name: next }) });
      await refresh();
      setEditingName(false);
    } catch (e: any) { setMessage(e?.message || "Ad değiştirilemedi"); }
    finally { setSavingName(false); }
  };

  const doTransfer = async (userId: string) => {
    setBusy(userId); setMessage(null);
    try {
      await apiPost("/households/transfer-admin", { user_id: userId });
      await refresh();
      setTransferTo(null);
      setMessage("Yöneticilik devredildi");
    } catch (e: any) { setMessage(e?.message || "Devredilemedi"); }
    finally { setBusy(null); }
  };

  const setAvatar = async (id: number) => {
    if (id === user?.avatar_id || savingAvatar) return;
    setSavingAvatar(true);
    try {
      await api("/auth/profile", { method: "PATCH", body: JSON.stringify({ avatar_id: id }) });
      await refreshAuth();
      await refresh();
    } finally { setSavingAvatar(false); }
  };

  const shareInvite = async () => {
    if (!household) return;
    const text = `KaSa'ya katıl! Ev: "${household.name}". Davet kodu: ${household.invite_code}`;
    if (Platform.OS === "web") {
      try {
        // @ts-ignore
        if (navigator.share) await navigator.share({ text });
        else if (navigator.clipboard) await navigator.clipboard.writeText(text);
      } catch {}
    } else {
      try { await Share.share({ message: text }); } catch {}
    }
  };

  const approve = async (userId: string) => {
    setBusy(userId);
    try { await apiPost("/households/approve", { user_id: userId }); await refresh(); }
    finally { setBusy(null); }
  };
  const reject = async (userId: string) => {
    setBusy(userId);
    try { await apiPost("/households/reject", { user_id: userId }); await refresh(); }
    finally { setBusy(null); }
  };
  const leave = async () => {
    try { await apiPost("/households/leave", {}); await refresh(); router.replace("/onboarding"); }
    catch (e) { console.log(e); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="settings-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="settings-back" hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Ayarlar</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.profileCard}>
          <Avatar name={user?.name || "?"} size={64} avatarId={user?.avatar_id} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name}</Text>
            <Text style={styles.email}>{user?.email}</Text>
          </View>
        </Card>

        <Text style={styles.section}>Avatarını seç</Text>
        <Card style={{ padding: spacing.md }}>
          <View style={styles.avatarGrid}>
            {AVATARS.map((a) => {
              const active = (user?.avatar_id ?? 0) === a.id;
              return (
                <Pressable
                  key={a.id}
                  onPress={() => setAvatar(a.id)}
                  style={[styles.avatarChoice, { backgroundColor: a.color }, active && styles.avatarChoiceActive]}
                  testID={`avatar-choice-${a.id}`}
                  disabled={savingAvatar}
                >
                  <Ionicons name={a.icon as any} size={28} color="#fff" />
                  {active && (
                    <View style={styles.avatarCheck}>
                      <Ionicons name="checkmark" size={12} color={colors.brand} />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
          {savingAvatar && (
            <View style={{ alignItems: "center", marginTop: spacing.sm }}>
              <ActivityIndicator color={colors.brand} size="small" />
            </View>
          )}
        </Card>

        {household && pendingMembers.length > 0 && !isAdmin && (
          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={16} color={colors.onBrandSoft} />
            <Text style={styles.infoTxt}>
              {pendingMembers.length} kişi katılmayı bekliyor. Onaylama yetkisi ev yöneticisinde.
            </Text>
          </View>
        )}

        {household && pendingMembers.length > 0 && isAdmin && (
          <>
            <View style={styles.sectionHead}>
              <Text style={styles.section}>Onay bekleyenler</Text>
              <View style={styles.badge}><Text style={styles.badgeTxt}>{pendingMembers.length}</Text></View>
            </View>
            {pendingMembers.map((p) => (
              <Card key={p.user_id} style={styles.pendingRow} testID={`pending-row-${p.user_id}`}>
                <Avatar name={p.name} size={40} avatarId={(p as any).avatar_id} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{p.name}</Text>
                  <Text style={styles.email}>{p.email}</Text>
                </View>
                {busy === p.user_id ? (
                  <ActivityIndicator color={colors.brand} />
                ) : (
                  <View style={styles.pendingActions}>
                    <Pressable style={styles.rejectBtn} onPress={() => reject(p.user_id)} testID={`reject-${p.user_id}`}>
                      <Ionicons name="close" size={18} color={colors.error} />
                    </Pressable>
                    <Pressable style={styles.approveBtn} onPress={() => approve(p.user_id)} testID={`approve-${p.user_id}`}>
                      <Ionicons name="checkmark" size={18} color="#fff" />
                    </Pressable>
                  </View>
                )}
              </Card>
            ))}
          </>
        )}

        {household && (
          <>
            <Text style={styles.section}>Ev</Text>
            <Card>
              {editingName ? (
                <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
                  <TextInput
                    style={styles.nameInput}
                    value={nameDraft}
                    onChangeText={setNameDraft}
                    placeholder="Ev adı"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    autoFocus
                    testID="household-name-edit"
                  />
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <Pressable
                      style={styles.nameCancel}
                      onPress={() => { setEditingName(false); setMessage(null); }}
                      testID="cancel-rename"
                    >
                      <Text style={styles.nameCancelTxt}>Vazgeç</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.nameSave, savingName && { opacity: 0.6 }]}
                      onPress={saveName}
                      disabled={savingName}
                      testID="save-rename"
                    >
                      {savingName
                        ? <ActivityIndicator color={colors.onBrand} size="small" />
                        : <Text style={styles.nameSaveTxt}>Kaydet</Text>}
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.homeNameRow}>
                  <Text style={styles.homeName}>{household.name}</Text>
                  {isAdmin && (
                    <Pressable
                      onPress={() => { setNameDraft(household.name); setEditingName(true); }}
                      hitSlop={10}
                      testID="edit-household-name"
                    >
                      <Ionicons name="pencil" size={18} color={colors.brand} />
                    </Pressable>
                  )}
                </View>
              )}
              <Text style={styles.subtitle}>Davet kodu</Text>
              <Text style={styles.inviteCode} testID="invite-code-display">{household.invite_code}</Text>
              <Text style={styles.inviteHint}>
                Bu kodu paylaştığın kişiler önce onayına gelir, sonra eve katılır.
              </Text>
              <Pressable style={styles.shareBtn} onPress={shareInvite} testID="share-invite-btn">
                <Ionicons name="share-social" size={16} color="#fff" />
                <Text style={styles.shareTxt}>Paylaş</Text>
              </Pressable>
            </Card>

            <Text style={styles.section}>Üyeler ({members.length})</Text>
            {members.map((m) => {
              const memberIsAdmin = m.user_id === adminId;
              const canHandOver = isAdmin && !memberIsAdmin;
              return (
                <Card key={m.user_id} style={styles.memberRow}>
                  <Avatar name={m.name} size={40} avatarId={(m as any).avatar_id} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.memberNameRow}>
                      <Text style={styles.memberName}>{m.name}{m.user_id === user?.user_id ? " (sen)" : ""}</Text>
                      {memberIsAdmin && (
                        <View style={styles.adminBadge}>
                          <Ionicons name="shield-checkmark" size={11} color={colors.onBrandSoft} />
                          <Text style={styles.adminBadgeTxt}>Yönetici</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.email}>{m.email}</Text>
                  </View>
                  {canHandOver && (
                    busy === m.user_id ? (
                      <ActivityIndicator color={colors.brand} />
                    ) : transferTo === m.user_id ? (
                      <View style={styles.confirmRow}>
                        <Pressable onPress={() => setTransferTo(null)} hitSlop={8} testID={`cancel-transfer-${m.user_id}`}>
                          <Text style={styles.cancelSmall}>Vazgeç</Text>
                        </Pressable>
                        <Pressable
                          style={styles.confirmSmall}
                          onPress={() => doTransfer(m.user_id)}
                          testID={`confirm-transfer-${m.user_id}`}
                        >
                          <Text style={styles.confirmSmallTxt}>Onayla</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => { setTransferTo(m.user_id); setMessage(null); }}
                        hitSlop={8}
                        testID={`transfer-admin-${m.user_id}`}
                      >
                        <Text style={styles.transferLink}>Yönetici yap</Text>
                      </Pressable>
                    )
                  )}
                </Card>
              );
            })}
            {transferTo && (
              <Text style={styles.warnTxt}>
                Yöneticiliği devredersen onaylama, ev adı değiştirme ve dönem kapatma
                yetkilerini kaybedersin.
              </Text>
            )}
            {message && <Text style={styles.message}>{message}</Text>}
          </>
        )}

        <View style={styles.danger}>
          {household && (
            <Pressable style={styles.leaveBtn} onPress={leave} testID="leave-household-btn">
              <Ionicons name="exit-outline" size={18} color={colors.error} />
              <Text style={styles.leaveTxt}>Evden ayrıl</Text>
            </Pressable>
          )}
          <Pressable style={styles.logoutBtn} onPress={logout} testID="logout-btn">
            <Text style={styles.logoutTxt}>Çıkış yap</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceAlt },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: colors.surface },
  title: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.onSurface },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  profileCard: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  name: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, color: colors.onSurface },
  email: { fontSize: font.sizes.sm, color: colors.onSurfaceTertiary },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  section: { fontSize: font.sizes.sm, fontWeight: font.weights.semibold, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.6, marginTop: spacing.md },
  badge: { backgroundColor: colors.coral, borderRadius: radius.pill, minWidth: 22, height: 22, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeTxt: { color: "#fff", fontSize: 11, fontWeight: font.weights.bold },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: "#FFF7ED", borderColor: "#FED7AA" },
  pendingActions: { flexDirection: "row", gap: spacing.sm },
  approveBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.mint, alignItems: "center", justifyContent: "center" },
  rejectBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#FEE2E2", borderWidth: 1, borderColor: "#FCA5A5", alignItems: "center", justifyContent: "center" },
  homeName: { fontSize: font.sizes.lg, fontWeight: font.weights.semibold, color: colors.onSurface },
  subtitle: { fontSize: font.sizes.sm, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: font.weights.semibold, marginBottom: spacing.xs },
  inviteCode: { fontSize: 36, fontWeight: font.weights.bold, letterSpacing: 10, color: colors.brand, marginBottom: spacing.sm },
  inviteHint: { fontSize: font.sizes.sm, color: colors.onSurfaceTertiary, marginBottom: spacing.md, lineHeight: 18 },
  shareBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: colors.brand, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2, borderRadius: radius.pill },
  shareTxt: { color: "#fff", fontWeight: font.weights.semibold, fontSize: font.sizes.base },
  memberRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  memberName: { fontSize: font.sizes.base, fontWeight: font.weights.semibold, color: colors.onSurface },
  memberNameRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  adminBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: colors.brandSoft, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.sm,
  },
  adminBadgeTxt: { fontSize: 10, fontWeight: font.weights.bold, color: colors.onBrandSoft },
  transferLink: { color: colors.brand, fontSize: font.sizes.sm, fontWeight: font.weights.semibold },
  confirmRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cancelSmall: { color: colors.onSurfaceTertiary, fontSize: font.sizes.sm },
  confirmSmall: { backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  confirmSmallTxt: { color: colors.onBrand, fontSize: font.sizes.sm, fontWeight: font.weights.semibold },
  warnTxt: { fontSize: font.sizes.sm, color: colors.onSurfaceSecondary, lineHeight: 18, paddingHorizontal: spacing.xs },
  message: { color: colors.success, fontWeight: font.weights.semibold, textAlign: "center", marginTop: spacing.sm },
  infoBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.brandSoft, padding: spacing.md, borderRadius: radius.md,
  },
  infoTxt: { flex: 1, fontSize: font.sizes.sm, color: colors.onBrandSoft, lineHeight: 18 },
  homeNameRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  nameInput: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: font.sizes.lg, color: colors.onSurface, minHeight: 48,
  },
  nameCancel: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  nameCancelTxt: { color: colors.onSurfaceSecondary, fontWeight: font.weights.semibold },
  nameSave: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.brand, minHeight: 40 },
  nameSaveTxt: { color: colors.onBrand, fontWeight: font.weights.semibold },
  avatarGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, justifyContent: "space-between" },
  avatarChoice: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: "center", justifyContent: "center",
    borderWidth: 3, borderColor: "transparent",
  },
  avatarChoiceActive: { borderColor: colors.brand, transform: [{ scale: 1.08 }] },
  avatarCheck: {
    position: "absolute", bottom: -2, right: -2,
    width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.brand,
  },
  danger: { gap: spacing.sm, marginTop: spacing.xxl },
  leaveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "transparent", borderWidth: 1, borderColor: colors.error, borderRadius: radius.pill, paddingVertical: spacing.md },
  leaveTxt: { color: colors.error, fontWeight: font.weights.semibold, fontSize: font.sizes.base },
  logoutBtn: { paddingVertical: spacing.md, alignItems: "center" },
  logoutTxt: { color: colors.onSurfaceTertiary, fontWeight: font.weights.semibold, fontSize: font.sizes.base },
});
