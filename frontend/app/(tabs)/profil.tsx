/** Profil sekmesi — avatar, ev + davet kodu, onay bekleyenler, üye listesi, çıkış.
 *  Eskiden /settings altında bir yığın ekranıydı ve yalnızca Panel'deki avatara
 *  dokunarak açılıyordu — kimse bulamıyordu. Artık alt menüde kendi sekmesi var. */
import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Share, Platform, ActivityIndicator, TextInput, Switch } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import { apiPost, api } from "@/src/api";
import { Avatar, Card, Divider, ScreenHeader, Sheet, Tag } from "@/src/ui";
import { pickPhotoFromLibrary, takePhotoWithCamera, removePhoto } from "@/src/photo";
import { colors, spacing, radius, type as T, overline, AVATARS, fontFamily } from "@/src/theme";

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
  const [regenConfirm, setRegenConfirm] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
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

  const regenerateInvite = async () => {
    setRegenBusy(true); setError(null); setMessage(null);
    try {
      await apiPost("/households/regenerate-invite", {});
      await refresh();
      setRegenConfirm(false);
      setMessage("Yeni davet kodu oluşturuldu");
    } catch (e: any) { setError(e?.message || "Kod yenilenemedi"); }
    finally { setRegenBusy(false); }
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
    <View style={styles.root} testID="profil-screen">
      {/* Profil kartı yok: kişi doğrudan koyu başlığın kendisi. */}
      <ScreenHeader overline="PROFİL" title={user?.name || "—"}>
        <View style={styles.heroRow}>
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
                ? <ActivityIndicator size="small" color={colors.onDark} />
                : <Ionicons name="camera" size={13} color={colors.onDark} />}
            </View>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroEmail}>{user?.email}</Text>
            {household ? <Text style={styles.heroHome}>{household.name}</Text> : null}
          </View>
        </View>
      </ScreenHeader>

      <Sheet>
        <ScrollView contentContainerStyle={styles.scroll}>
          {photoMenu && (
            <Card>
              {[
                { label: "Fotoğraf çek", icon: "camera-outline", run: takePhotoWithCamera },
                { label: "Galeriden seç", icon: "images-outline", run: pickPhotoFromLibrary },
              ].map((opt, i) => (
                <View key={opt.label}>
                  {i > 0 && <Divider inset={spacing.lg} />}
                  <Pressable
                    style={styles.photoOpt}
                    onPress={() => doPhoto(opt.run)}
                    disabled={photoBusy}
                    testID={`photo-${opt.icon}`}
                  >
                    <Ionicons name={opt.icon as any} size={19} color={colors.dark} />
                    <Text style={styles.photoOptTxt}>{opt.label}</Text>
                  </Pressable>
                </View>
              ))}
              {(user as any)?.photo_version && (
                <>
                  <Divider inset={spacing.lg} />
                  <Pressable
                    style={styles.photoOpt}
                    onPress={() => doPhoto(async () => { await removePhoto(); return { ok: true }; })}
                    disabled={photoBusy}
                    testID="photo-remove"
                  >
                    <Ionicons name="trash-outline" size={19} color={colors.negative} />
                    <Text style={[styles.photoOptTxt, { color: colors.negative }]}>Fotoğrafı kaldır</Text>
                  </Pressable>
                </>
              )}
            </Card>
          )}

          <Card title="Avatarını Seç" padded>
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
                    <Ionicons name={a.icon as any} size={26} color={colors.onDark} />
                    {active && (
                      <View style={styles.avatarCheck}>
                        <Ionicons name="checkmark" size={12} color={colors.dark} />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
            {savingAvatar && (
              <View style={{ alignItems: "center", marginTop: spacing.sm }}>
                <ActivityIndicator color={colors.dark} size="small" />
              </View>
            )}
          </Card>

          {household && pendingMembers.length > 0 && !isAdmin && (
            <View style={styles.infoBox}>
              <Ionicons name="information-circle" size={16} color={colors.accentDark} />
              <Text style={styles.infoTxt}>
                {pendingMembers.length} kişi katılmayı bekliyor. Onaylama yetkisi ev yöneticisinde.
              </Text>
            </View>
          )}

          {household && pendingMembers.length > 0 && isAdmin && (
            <Card title={`Onay Bekleyenler (${pendingMembers.length})`}>
              {openExpenseCount > 0 && (
                <View style={styles.warnBox} testID="mid-period-join-warning">
                  <Ionicons name="alert-circle" size={16} color={colors.onWarning} />
                  <Text style={styles.warnBoxTxt}>
                    Açık dönemde {openExpenseCount} ev harcaması var. Onaylarsan yeni üye
                    bunların da payını üstlenir. Taşınmadan önceki harcamalara karışmasın
                    istiyorsan önce Kasa'dan dönemi kapat.
                  </Text>
                </View>
              )}
              {pendingMembers.map((p, i) => (
                <View key={p.user_id} testID={`pending-row-${p.user_id}`}>
                  {i > 0 && <Divider />}
                  <View style={styles.personRow}>
                    <Avatar name={p.name} size={40} avatarId={(p as any).avatar_id} userId={p.user_id} photoVersion={(p as any).photo_version} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{p.name}</Text>
                      <Text style={styles.email}>{p.email}</Text>
                    </View>
                    {busy === p.user_id ? (
                      <ActivityIndicator color={colors.dark} />
                    ) : (
                      <View style={styles.pendingActions}>
                        <Pressable style={styles.rejectBtn} onPress={() => reject(p.user_id)} testID={`reject-${p.user_id}`}>
                          <Ionicons name="close" size={18} color={colors.negative} />
                        </Pressable>
                        <Pressable style={styles.approveBtn} onPress={() => approve(p.user_id)} testID={`approve-${p.user_id}`}>
                          <Ionicons name="checkmark" size={18} color={colors.onDark} />
                        </Pressable>
                      </View>
                    )}
                  </View>
                </View>
              ))}
            </Card>
          )}

          {household && (
            <>
              <Card title="Ev" padded>
                {editingName ? (
                  <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
                    <TextInput
                      style={styles.nameInput}
                      value={nameDraft}
                      onChangeText={setNameDraft}
                      placeholder="Ev adı"
                      placeholderTextColor={colors.inkTertiary}
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
                        <Ionicons name="pencil" size={18} color={colors.accentDark} />
                      </Pressable>
                    )}
                  </View>
                )}

                {/* Davet kodu ekranın ikinci "kahraman" rakamı — kart içinde
                    kendi koyu alanında durur, gri bir satır olarak değil. */}
                <View style={styles.inviteBox}>
                  <Text style={styles.inviteLabel}>DAVET KODU</Text>
                  <Text style={styles.inviteCode} testID="invite-code-display">{household.invite_code}</Text>
                </View>
                <Text style={styles.inviteHint}>
                  Bu kodu paylaştığın kişiler önce onayına gelir, sonra eve katılır.
                </Text>
                <View style={styles.inviteActions}>
                  <Pressable style={styles.shareBtn} onPress={shareInvite} testID="share-invite-btn">
                    <Ionicons name="share-social" size={16} color={colors.onBrand} />
                    <Text style={styles.shareTxt}>Paylaş</Text>
                  </Pressable>
                  {isAdmin && (
                    regenConfirm ? (
                      <View style={styles.confirmRow}>
                        <Pressable onPress={() => setRegenConfirm(false)} hitSlop={8} testID="cancel-regen">
                          <Text style={styles.cancelSmall}>Vazgeç</Text>
                        </Pressable>
                        <Pressable style={styles.confirmSmall} onPress={regenerateInvite}
                                   disabled={regenBusy} testID="confirm-regen">
                          {regenBusy ? <ActivityIndicator size="small" color={colors.onBrand} />
                                     : <Text style={styles.confirmSmallTxt}>Yenile</Text>}
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable onPress={() => { setRegenConfirm(true); setMessage(null); setError(null); }}
                                 hitSlop={8} testID="regen-invite-btn">
                        <Text style={styles.transferLink}>Kodu yenile</Text>
                      </Pressable>
                    )
                  )}
                </View>
                {regenConfirm && (
                  <Text style={styles.warnTxt}>
                    Eski kod geçersiz olur. Evden ayrılan biri kodu hâlâ biliyorsa
                    bir daha katılma isteği gönderemez.
                  </Text>
                )}
              </Card>

              <Card title={`Üyeler (${members.length})`}>
                {members.map((m, i) => {
                  const memberIsAdmin = m.user_id === adminId;
                  const canHandOver = isAdmin && !memberIsAdmin;
                  return (
                    <View key={m.user_id}>
                      {i > 0 && <Divider />}
                      <View style={styles.personRow}>
                        <Avatar name={m.name} size={40} avatarId={(m as any).avatar_id} userId={m.user_id} photoVersion={(m as any).photo_version} />
                        <View style={{ flex: 1 }}>
                          <View style={styles.memberNameRow}>
                            <Text style={styles.memberName}>{m.name}{m.user_id === user?.user_id ? " (sen)" : ""}</Text>
                            {memberIsAdmin && (
                              <Tag label="Yönetici" tint={colors.accentSoft} color={colors.accentDark} />
                            )}
                          </View>
                          <Text style={styles.email}>{m.email}</Text>
                        </View>
                        {canHandOver && (
                          busy === m.user_id ? (
                            <ActivityIndicator color={colors.dark} />
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
                      </View>
                    </View>
                  );
                })}
              </Card>

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

          <Card title="Hesap">
            {([
              { key: "name", label: "Adını değiştir", value: user?.name, icon: "person-outline" },
              { key: "email", label: "E-postanı değiştir", value: user?.email, icon: "mail-outline" },
              { key: "password", label: "Şifreni değiştir", value: "••••••••", icon: "lock-closed-outline" },
            ] as const).map((row, i) => (
              <View key={row.key}>
                {i > 0 && <Divider />}
                <Pressable
                  style={styles.accountRow}
                  onPress={() => openAccount(row.key)}
                  testID={`account-${row.key}`}
                  android_ripple={{ color: colors.divider }}
                >
                  <View style={styles.accountIcon}>
                    <Ionicons name={row.icon as any} size={18} color={colors.inkSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.accountLabel}>{row.label}</Text>
                    <Text style={styles.accountValue} numberOfLines={1}>{row.value}</Text>
                  </View>
                  <Ionicons
                    name={accountMode === row.key ? "chevron-up" : "chevron-forward"}
                    size={18}
                    color={colors.inkTertiary}
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
                        placeholderTextColor={colors.inkTertiary}
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
                          placeholderTextColor={colors.inkTertiary}
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
                          placeholderTextColor={colors.inkTertiary}
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
                          placeholderTextColor={colors.inkTertiary}
                          secureTextEntry
                          autoCapitalize="none"
                          testID="input-current-pw"
                        />
                        <TextInput
                          style={styles.accountInput}
                          value={form.newPw}
                          onChangeText={(v) => setForm({ ...form, newPw: v })}
                          placeholder="Yeni şifre (en az 6 karakter)"
                          placeholderTextColor={colors.inkTertiary}
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

          <Card title="Bildirimler">
            {[
              { key: "new_expense", label: "Yeni harcama", desc: "Ev arkadaşın harcama eklediğinde" },
              { key: "join_request", label: "Katılma istekleri", desc: "İstek geldiğinde veya onaylandığında" },
              { key: "period_closed", label: "Dönem kapatma", desc: "Dönem kapatılıp sıfırlandığında" },
            ].map((row, i) => (
              <View key={row.key}>
                {i > 0 && <Divider inset={spacing.lg} />}
                <View style={styles.prefRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.prefLabel}>{row.label}</Text>
                    <Text style={styles.prefDesc}>{row.desc}</Text>
                  </View>
                  <Switch
                    value={prefs[row.key] !== false}
                    onValueChange={(v) => setPref(row.key, v)}
                    trackColor={{ false: colors.border, true: colors.accent }}
                    thumbColor={colors.surface}
                    testID={`pref-${row.key}`}
                  />
                </View>
              </View>
            ))}
          </Card>

          <View style={styles.danger}>
            {household && (
              <Pressable style={styles.leaveBtn} onPress={leave} testID="leave-household-btn">
                <Ionicons name="exit-outline" size={18} color={colors.negative} />
                <Text style={styles.leaveTxt}>Evden ayrıl</Text>
              </Pressable>
            )}
            <Pressable style={styles.logoutBtn} onPress={logout} testID="logout-btn">
              <Text style={styles.logoutTxt}>Çıkış yap</Text>
            </Pressable>
          </View>
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  heroRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginTop: spacing.xs },
  heroEmail: { ...T.body, color: colors.onDarkMuted },
  heroHome: { ...T.captionSb, color: colors.accentOnDark, marginTop: 2 },
  // Tab bar sits on top of the content, so leave room at the bottom.
  scroll: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md, paddingBottom: 120 },
  email: { ...T.caption, color: colors.inkTertiary },

  photoOpt: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  photoOptTxt: { ...T.bodySb, color: colors.ink },

  avatarGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, justifyContent: "space-between" },
  avatarChoice: {
    width: 58, height: 58, borderRadius: 29,
    alignItems: "center", justifyContent: "center",
    borderWidth: 3, borderColor: "transparent",
  },
  avatarChoiceActive: { borderColor: colors.accent, transform: [{ scale: 1.06 }] },
  avatarCheck: {
    position: "absolute", bottom: -2, right: -2,
    width: 20, height: 20, borderRadius: 10, backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.accent,
  },

  personRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  memberName: { ...T.bodySb, color: colors.ink },
  memberNameRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  pendingActions: { flexDirection: "row", gap: spacing.sm },
  approveBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  rejectBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: colors.negativeSoft,
    alignItems: "center", justifyContent: "center",
  },

  homeNameRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  homeName: { ...T.emph, color: colors.ink },
  inviteBox: {
    backgroundColor: colors.dark, borderRadius: radius.lg,
    paddingVertical: spacing.lg, paddingHorizontal: spacing.lg, alignItems: "center",
  },
  inviteLabel: { ...overline, color: colors.onDarkMuted },
  inviteCode: {
    fontSize: 34, lineHeight: 42, fontFamily: fontFamily.bold, letterSpacing: 9,
    color: colors.onDark, marginTop: spacing.xs, marginLeft: 9,
  },
  inviteHint: { ...T.caption, color: colors.inkTertiary, marginTop: spacing.md, lineHeight: 18 },
  inviteActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, marginTop: spacing.md },
  shareBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 3, borderRadius: radius.pill,
  },
  shareTxt: { ...T.bodySb, color: colors.onBrand },

  transferLink: { ...T.captionSb, color: colors.accentDark },
  removeLink: { ...T.captionSb, color: colors.negative },
  actionsCol: { alignItems: "flex-end", gap: 6 },
  removeConfirm: { backgroundColor: colors.negative, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill },
  confirmRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cancelSmall: { ...T.caption, color: colors.inkTertiary },
  confirmSmall: { backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill },
  confirmSmallTxt: { ...T.captionSb, color: colors.onBrand },

  errorMsg: { ...T.bodySb, color: colors.negative, textAlign: "center", marginTop: spacing.sm },
  message: { ...T.bodySb, color: colors.accentDark, textAlign: "center", marginTop: spacing.sm },
  warnTxt: { ...T.caption, color: colors.inkSecondary, lineHeight: 18, paddingHorizontal: spacing.xs },
  infoBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.accentSoft, padding: spacing.md, borderRadius: radius.md,
  },
  infoTxt: { flex: 1, ...T.caption, color: colors.accentDark, lineHeight: 18 },
  warnBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: colors.warningSoft,
    padding: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.sm,
    borderRadius: radius.md,
  },
  warnBoxTxt: { flex: 1, ...T.caption, color: colors.onWarning, lineHeight: 18 },

  cameraBadge: {
    position: "absolute", right: -2, bottom: -2,
    width: 24, height: 24, borderRadius: 12, backgroundColor: colors.accent,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.dark,
  },

  accountRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  accountIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  accountLabel: { ...T.bodySb, color: colors.ink },
  accountValue: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  accountForm: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  accountInput: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 15, fontFamily: fontFamily.regular, color: colors.ink, minHeight: 48,
  },
  accountHint: { ...T.caption, color: colors.inkTertiary, lineHeight: 17 },
  accountSave: {
    backgroundColor: colors.brand, borderRadius: radius.pill, minHeight: 46,
    alignItems: "center", justifyContent: "center", marginTop: spacing.xs,
  },
  accountSaveTxt: { ...T.bodySb, color: colors.onBrand },

  prefRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  prefLabel: { ...T.bodySb, color: colors.ink },
  prefDesc: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },

  nameInput: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 16, fontFamily: fontFamily.regular, color: colors.ink, minHeight: 50,
  },
  nameCancel: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  nameCancelTxt: { ...T.bodySb, color: colors.inkSecondary },
  nameSave: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.brand, minHeight: 44 },
  nameSaveTxt: { ...T.bodySb, color: colors.onBrand },

  danger: { gap: spacing.sm, marginTop: spacing.xl },
  leaveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "transparent", borderWidth: 1, borderColor: colors.negative,
    borderRadius: radius.pill, paddingVertical: spacing.md, minHeight: 50,
  },
  leaveTxt: { ...T.bodySb, color: colors.negative },
  logoutBtn: { paddingVertical: spacing.md, alignItems: "center" },
  logoutTxt: { ...T.bodySb, color: colors.inkTertiary },
});
