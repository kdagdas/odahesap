/** Profil sekmesi — avatar, ev + davet kodu, onay bekleyenler, üye listesi, çıkış.
 *  Eskiden /settings altında bir yığın ekranıydı ve yalnızca Panel'deki avatara
 *  dokunarak açılıyordu — kimse bulamıyordu. Artık alt menüde kendi sekmesi var. */
import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Share, Platform, ActivityIndicator, TextInput, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import { apiPost, api } from "@/src/api";
import { Avatar, Card } from "@/src/ui";
import { pickPhotoFromLibrary, takePhotoWithCamera, removePhoto } from "@/src/photo";
import { colors, spacing, radius, font, AVATARS } from "@/src/theme";

export default function Profil() {
  const router = useRouter();
  const { user, logout, refresh: refreshAuth } = useAuth();
  const { household, members, pendingMembers, isAdmin, adminId, openExpenseCount, refresh } = useHousehold();
  const [busy, setBusy] = useState<string | null>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [transferTo, setTransferTo] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photoMenu, setPhotoMenu] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [accountMode, setAccountMode] = useState<"none" | "name" | "email" | "password">("none");
  const [form, setForm] = useState({ name: "", email: "", pw: "", newPw: "" });
  const [savingAccount, setSavingAccount] = useState(false);

  // Join requests land while the app is already open — without re-fetching on
  // focus, the admin never sees them until a full restart.
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const prefs = (user as any)?.notif_prefs ?? {
    new_expense: true, join_request: true, period_closed: true,
  };

  const setPref = async (key: string, value: boolean) => {
    try {
      await api("/auth/notifications", {
        method: "PATCH",
        body: JSON.stringify({ [key]: value }),
      });
      await refreshAuth();
    } catch (e: any) { setError(e?.message || "Ayar kaydedilemedi"); }
  };

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
    setBusy(userId); setMessage(null); setError(null);
    try {
      await apiPost("/households/transfer-admin", { user_id: userId });
      await refresh();
      setTransferTo(null);
      setMessage("Yöneticilik devredildi");
    } catch (e: any) { setError(e?.message || "Devredilemedi"); }
    finally { setBusy(null); }
  };

  const doRemove = async (userId: string, name: string) => {
    setBusy(userId); setMessage(null); setError(null);
    try {
      await apiPost("/households/remove-member", { user_id: userId });
      await refresh();
      setRemoveTarget(null);
      setMessage(`${name} evden çıkarıldı`);
    } catch (e: any) { setError(e?.message || "Çıkarılamadı"); }
    finally { setBusy(null); }
  };

  const doPhoto = async (run: () => Promise<{ ok: boolean; error?: string }>) => {
    setPhotoBusy(true); setError(null); setMessage(null);
    try {
      const res = await run();
      if (res.error) setError(res.error);
      else if (res.ok) {
        await refreshAuth();
        await refresh();
        setPhotoMenu(false);
        setMessage("Fotoğraf güncellendi");
      }
    } catch (e: any) { setError(e?.message || "Fotoğraf yüklenemedi"); }
    finally { setPhotoBusy(false); }
  };

  const openAccount = (mode: "name" | "email" | "password") => {
    setAccountMode(accountMode === mode ? "none" : mode);
    setForm({ name: user?.name || "", email: "", pw: "", newPw: "" });
    setError(null); setMessage(null);
  };

  const saveAccount = async () => {
    setSavingAccount(true); setError(null); setMessage(null);
    try {
      if (accountMode === "name") {
        if (!form.name.trim()) { setError("Ad boş olamaz"); return; }
        await api("/auth/profile", { method: "PATCH", body: JSON.stringify({ name: form.name.trim() }) });
        setMessage("Adın güncellendi");
      } else if (accountMode === "email") {
        await apiPost("/auth/change-email", { new_email: form.email.trim(), password: form.pw });
        setMessage("E-postan güncellendi");
      } else if (accountMode === "password") {
        if (form.newPw.length < 6) { setError("Yeni şifre en az 6 karakter olmalı"); return; }
        await apiPost("/auth/change-password", { current_password: form.pw, new_password: form.newPw });
        setMessage("Şifren değiştirildi. Diğer cihazlardaki oturumlar kapatıldı.");
      }
      await refreshAuth();
      await refresh();
      setAccountMode("none");
      setForm({ name: "", email: "", pw: "", newPw: "" });
    } catch (e: any) { setError(e?.message || "Kaydedilemedi"); }
    finally { setSavingAccount(false); }
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
    <SafeAreaView style={styles.root} edges={["top"]} testID="profil-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Profil</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.profileCard}>
          <Pressable onPress={() => setPhotoMenu((v) => !v)} testID="profile-photo-btn">
            <Avatar
              name={user?.name || "?"}
              size={64}
              avatarId={user?.avatar_id}
              userId={user?.user_id}
              photoVersion={(user as any)?.photo_version}
            />
            <View style={styles.cameraBadge}>
              {photoBusy
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="camera" size={13} color="#fff" />}
            </View>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name}</Text>
            <Text style={styles.email}>{user?.email}</Text>
          </View>
        </Card>

        {photoMenu && (
          <Card style={{ padding: spacing.sm }}>
            {[
              { label: "Fotoğraf çek", icon: "camera-outline", run: takePhotoWithCamera },
              { label: "Galeriden seç", icon: "images-outline", run: pickPhotoFromLibrary },
            ].map((opt) => (
              <Pressable
                key={opt.label}
                style={styles.photoOpt}
                onPress={() => doPhoto(opt.run)}
                disabled={photoBusy}
                testID={`photo-${opt.icon}`}
              >
                <Ionicons name={opt.icon as any} size={19} color={colors.brand} />
                <Text style={styles.photoOptTxt}>{opt.label}</Text>
              </Pressable>
            ))}
            {(user as any)?.photo_version && (
              <Pressable
                style={styles.photoOpt}
                onPress={() => doPhoto(async () => { await removePhoto(); return { ok: true }; })}
                disabled={photoBusy}
                testID="photo-remove"
              >
                <Ionicons name="trash-outline" size={19} color={colors.error} />
                <Text style={[styles.photoOptTxt, { color: colors.error }]}>Fotoğrafı kaldır</Text>
              </Pressable>
            )}
          </Card>
        )}

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
            {openExpenseCount > 0 && (
              <View style={styles.warnBox} testID="mid-period-join-warning">
                <Ionicons name="alert-circle" size={16} color="#B45309" />
                <Text style={styles.warnBoxTxt}>
                  Açık dönemde {openExpenseCount} ev harcaması var. Onaylarsan yeni üye
                  bunların da payını üstlenir. Taşınmadan önceki harcamalara karışmasın
                  istiyorsan önce Kasa'dan dönemi kapat.
                </Text>
              </View>
            )}
            {pendingMembers.map((p) => (
              <Card key={p.user_id} style={styles.pendingRow} testID={`pending-row-${p.user_id}`}>
                <Avatar name={p.name} size={40} avatarId={(p as any).avatar_id} userId={p.user_id} photoVersion={(p as any).photo_version} />
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
                  <Avatar name={m.name} size={40} avatarId={(m as any).avatar_id} userId={m.user_id} photoVersion={(m as any).photo_version} />
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
                    ) : removeTarget === m.user_id ? (
                      <View style={styles.confirmRow}>
                        <Pressable onPress={() => setRemoveTarget(null)} hitSlop={8} testID={`cancel-remove-${m.user_id}`}>
                          <Text style={styles.cancelSmall}>Vazgeç</Text>
                        </Pressable>
                        <Pressable
                          style={styles.removeConfirm}
                          onPress={() => doRemove(m.user_id, m.name)}
                          testID={`confirm-remove-${m.user_id}`}
                        >
                          <Text style={styles.confirmSmallTxt}>Çıkar</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <View style={styles.actionsCol}>
                        <Pressable
                          onPress={() => { setTransferTo(m.user_id); setRemoveTarget(null); setMessage(null); setError(null); }}
                          hitSlop={6}
                          testID={`transfer-admin-${m.user_id}`}
                        >
                          <Text style={styles.transferLink}>Yönetici yap</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => { setRemoveTarget(m.user_id); setTransferTo(null); setMessage(null); setError(null); }}
                          hitSlop={6}
                          testID={`remove-member-${m.user_id}`}
                        >
                          <Text style={styles.removeLink}>Evden çıkar</Text>
                        </Pressable>
                      </View>
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
            {removeTarget && (
              <Text style={styles.warnTxt}>
                Çıkarılan kişi evi ve harcamaları göremez. Geçmiş dönemlerdeki payı
                kayıtlarda kalır. Açık dönemde harcaması varsa önce dönemi kapatman gerekir.
              </Text>
            )}
            {message && <Text style={styles.message}>{message}</Text>}
            {error && <Text style={styles.errorMsg} testID="settings-error">{error}</Text>}
          </>
        )}

        <Text style={styles.section}>Hesap</Text>
        <Card style={{ padding: spacing.md, gap: spacing.xs }}>
          {([
            { key: "name", label: "Adını değiştir", value: user?.name, icon: "person-outline" },
            { key: "email", label: "E-postanı değiştir", value: user?.email, icon: "mail-outline" },
            { key: "password", label: "Şifreni değiştir", value: "••••••••", icon: "lock-closed-outline" },
          ] as const).map((row) => (
            <View key={row.key}>
              <Pressable
                style={styles.accountRow}
                onPress={() => openAccount(row.key)}
                testID={`account-${row.key}`}
              >
                <Ionicons name={row.icon as any} size={19} color={colors.onSurfaceSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.accountLabel}>{row.label}</Text>
                  <Text style={styles.accountValue} numberOfLines={1}>{row.value}</Text>
                </View>
                <Ionicons
                  name={accountMode === row.key ? "chevron-up" : "chevron-forward"}
                  size={18}
                  color={colors.onSurfaceTertiary}
                />
              </Pressable>

              {accountMode === row.key && (
                <View style={styles.accountForm}>
                  {row.key === "name" && (
                    <TextInput
                      style={styles.accountInput}
                      value={form.name}
                      onChangeText={(v) => setForm({ ...form, name: v })}
                      placeholder="Adın"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      autoCapitalize="words"
                      testID="input-name"
                    />
                  )}
                  {row.key === "email" && (
                    <>
                      <TextInput
                        style={styles.accountInput}
                        value={form.email}
                        onChangeText={(v) => setForm({ ...form, email: v })}
                        placeholder="Yeni e-posta"
                        placeholderTextColor={colors.onSurfaceTertiary}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        testID="input-new-email"
                      />
                      <TextInput
                        style={styles.accountInput}
                        value={form.pw}
                        onChangeText={(v) => setForm({ ...form, pw: v })}
                        placeholder="Mevcut şifren"
                        placeholderTextColor={colors.onSurfaceTertiary}
                        secureTextEntry
                        autoCapitalize="none"
                        testID="input-email-pw"
                      />
                      <Text style={styles.accountHint}>
                        Şifre soruluyor çünkü açık kalan bir telefonun hesabını başka
                        bir adrese taşımasını istemiyoruz.
                      </Text>
                    </>
                  )}
                  {row.key === "password" && (
                    <>
                      <TextInput
                        style={styles.accountInput}
                        value={form.pw}
                        onChangeText={(v) => setForm({ ...form, pw: v })}
                        placeholder="Mevcut şifren"
                        placeholderTextColor={colors.onSurfaceTertiary}
                        secureTextEntry
                        autoCapitalize="none"
                        testID="input-current-pw"
                      />
                      <TextInput
                        style={styles.accountInput}
                        value={form.newPw}
                        onChangeText={(v) => setForm({ ...form, newPw: v })}
                        placeholder="Yeni şifre (en az 6 karakter)"
                        placeholderTextColor={colors.onSurfaceTertiary}
                        secureTextEntry
                        autoCapitalize="none"
                        testID="input-new-pw"
                      />
                      <Text style={styles.accountHint}>
                        Şifreni değiştirince diğer cihazlardaki oturumlar kapanır,
                        bu telefon açık kalır.
                      </Text>
                    </>
                  )}
                  <Pressable
                    style={[styles.accountSave, savingAccount && { opacity: 0.6 }]}
                    onPress={saveAccount}
                    disabled={savingAccount}
                    testID={`save-${row.key}`}
                  >
                    {savingAccount
                      ? <ActivityIndicator color={colors.onBrand} size="small" />
                      : <Text style={styles.accountSaveTxt}>Kaydet</Text>}
                  </Pressable>
                </View>
              )}
            </View>
          ))}
        </Card>

        <Text style={styles.section}>Bildirimler</Text>
        <Card style={{ padding: spacing.md, gap: spacing.xs }}>
          {[
            { key: "new_expense", label: "Yeni harcama", desc: "Ev arkadaşın harcama eklediğinde" },
            { key: "join_request", label: "Katılma istekleri", desc: "İstek geldiğinde veya onaylandığında" },
            { key: "period_closed", label: "Dönem kapatma", desc: "Dönem kapatılıp sıfırlandığında" },
          ].map((row) => (
            <View key={row.key} style={styles.prefRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.prefLabel}>{row.label}</Text>
                <Text style={styles.prefDesc}>{row.desc}</Text>
              </View>
              <Switch
                value={prefs[row.key] !== false}
                onValueChange={(v) => setPref(row.key, v)}
                trackColor={{ false: colors.border, true: colors.brand }}
                thumbColor="#fff"
                testID={`pref-${row.key}`}
              />
            </View>
          ))}
        </Card>

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
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { fontSize: 26, fontWeight: font.weights.bold, color: colors.onSurface, letterSpacing: -0.3 },
  // Tab bar sits on top of the content, so leave room at the bottom.
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 120 },
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
  removeLink: { color: colors.error, fontSize: font.sizes.sm, fontWeight: font.weights.semibold },
  actionsCol: { alignItems: "flex-end", gap: 6 },
  removeConfirm: { backgroundColor: colors.error, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  errorMsg: { color: colors.error, fontWeight: font.weights.semibold, textAlign: "center", marginTop: spacing.sm, lineHeight: 20 },
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
  warnBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "#FEF3C7", borderWidth: 1, borderColor: "#FDE68A",
    padding: spacing.md, borderRadius: radius.md,
  },
  warnBoxTxt: { flex: 1, fontSize: font.sizes.sm, color: "#92400E", lineHeight: 18 },
  cameraBadge: {
    position: "absolute", right: -2, bottom: -2,
    width: 24, height: 24, borderRadius: 12, backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.surface,
  },
  photoOpt: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  photoOptTxt: { fontSize: font.sizes.base, fontWeight: font.weights.semibold, color: colors.onSurface },
  accountRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  accountLabel: { fontSize: font.sizes.base, fontWeight: font.weights.semibold, color: colors.onSurface },
  accountValue: { fontSize: font.sizes.sm, color: colors.onSurfaceTertiary, marginTop: 1 },
  accountForm: { gap: spacing.sm, paddingBottom: spacing.md, paddingTop: spacing.xs },
  accountInput: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: font.sizes.base, color: colors.onSurface, minHeight: 46,
  },
  accountHint: { fontSize: font.sizes.sm, color: colors.onSurfaceTertiary, lineHeight: 17 },
  accountSave: {
    backgroundColor: colors.brand, borderRadius: radius.pill, minHeight: 44,
    alignItems: "center", justifyContent: "center", marginTop: spacing.xs,
  },
  accountSaveTxt: { color: colors.onBrand, fontWeight: font.weights.semibold, fontSize: font.sizes.base },
  prefRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  prefLabel: { fontSize: font.sizes.base, fontWeight: font.weights.semibold, color: colors.onSurface },
  prefDesc: { fontSize: font.sizes.sm, color: colors.onSurfaceTertiary, marginTop: 1 },
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
