/** Profil — yalnızca SANA ait olanlar.
 *
 *  Eskiden burası beş ayrı işin toplandığı bir çekmeceydi: fotoğraf, ev adı,
 *  davet kodu, onay bekleyenler, üye yönetimi, hesap, bildirimler, çıkış.
 *  "Neyi nerede bulacağım" sorusunun cevabı yoktu.
 *
 *  Kural: kime ait olduğuna göre ayır — bana ait (burası), eve ait
 *  (/ev-ayarlari), uygulamaya ait (/ayarlar). Bundan sonra eklenen her
 *  özelliğin yeri bu soruyla belli oluyor.
 */
import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import { apiPost, apiGet, api } from "@/src/api";
import { Avatar, Card, Divider, ScreenHeader, Sheet, IconPill, useScrollPad } from "@/src/ui";
import { pickPhotoFromLibrary, takePhotoWithCamera, removePhoto } from "@/src/photo";
import { colors, spacing, radius, type as T, metrics, AVATARS, fontFamily, overline } from "@/src/theme";

export default function Profil() {
  // Sekme cubugunun ve telefonun gezinme cubugunun kapladigi yer.
  // Elle yazilan 120/130 sabitleri cubuk yuksekligiyle birlikte
  // degismiyordu; olcu artik tek yerden geliyor.
  const altPay = useScrollPad({ tabs: true });
  const router = useRouter();
  const { user, logout, refresh: refreshAuth } = useAuth();
  const { household, members, pendingMembers, isAdmin, refresh } = useHousehold();
  // Satirlarda gosterilecek DURUM ozetleri.
  const prefsAll = (user?.notif_prefs || {}) as Record<string, boolean>;
  const acikBildirim = ["new_expense", "expense_edit", "settlement", "period_closed"]
    .filter((k) => prefsAll[k] !== false).length;
  const [vadesiGelen, setVadesiGelen] = useState(0);
  const [hesapAcik, setHesapAcik] = useState(false);

  const [savingAvatar, setSavingAvatar] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photoMenu, setPhotoMenu] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [accountMode, setAccountMode] = useState<"none" | "name" | "email" | "password">("none");
  const [form, setForm] = useState({ name: "", email: "", pw: "", newPw: "" });
  const [savingAccount, setSavingAccount] = useState(false);

  useFocusEffect(useCallback(() => {
    refresh();
    // Vadesi gelen duzenli odeme sayisi: satirda DURUM olarak gorunuyor,
    // boylece "kirayi girdim mi" sorusu Profil'e girmeden cevaplaniyor.
    apiGet<{ due?: any[] }>("/recurring")
      .then((r) => setVadesiGelen((r.due || []).length))
      .catch(() => {});
  }, [refresh]));



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

  return (
    <View style={styles.root} testID="profil-screen">
      <ScrollView contentContainerStyle={[styles.page, altPay]} showsVerticalScrollIndicator={false}>
        <ScreenHeader overline="PROFİL" title={user?.name || "—"}>
          <View style={styles.heroRow}>
            <Pressable onPress={() => setPhotoMenu((v) => !v)} testID="profile-photo-btn">
              <Avatar name={user?.name || "?"} size={64} avatarId={user?.avatar_id}
                      userId={user?.user_id} photoVersion={(user as any)?.photo_version} />
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
          <View style={styles.scroll}>
            {photoMenu && (
              <Card>
                {[
                  { label: "Fotoğraf çek", icon: "camera-outline", run: takePhotoWithCamera },
                  { label: "Galeriden seç", icon: "images-outline", run: pickPhotoFromLibrary },
                ].map((opt, i) => (
                  <View key={opt.label}>
                    {i > 0 && <Divider inset={spacing.lg} />}
                    <Pressable style={styles.photoOpt} onPress={() => doPhoto(opt.run)}
                               disabled={photoBusy} testID={`photo-${opt.icon}`}>
                      <Ionicons name={opt.icon as any} size={19} color={colors.ink} />
                      <Text style={styles.photoOptTxt}>{opt.label}</Text>
                    </Pressable>
                  </View>
                ))}
                {(user as any)?.photo_version && (
                  <>
                    <Divider inset={spacing.lg} />
                    <Pressable style={styles.photoOpt}
                               onPress={() => doPhoto(async () => { await removePhoto(); return { ok: true }; })}
                               disabled={photoBusy} testID="photo-remove">
                      <Ionicons name="trash-outline" size={19} color={colors.negative} />
                      <Text style={[styles.photoOptTxt, { color: colors.negative }]}>Fotoğrafı kaldır</Text>
                    </Pressable>
                  </>
                )}

                {/* Avatar izgarasi buraya tasindi. Onceden asagida ayri bir
                    kartti ve resmini degistirmenin IKI yolu vardi: bastaki
                    avatara dokunmak ve o kart. Kozmetik bir ayar ekranin en
                    degerli yerini tutuyordu; simdi tek kapi. */}
                <Divider inset={spacing.lg} />
                <View style={styles.avatarBlock}>
                  <Text style={styles.avatarLabel}>YA DA BİR AVATAR SEÇ</Text>
                  <View style={styles.avatarGrid}>
                    {AVATARS.map((a) => {
                      const active = (user?.avatar_id ?? 0) === a.id;
                      return (
                        <Pressable key={a.id} onPress={() => setAvatar(a.id)}
                                   style={[styles.avatarChoice, { backgroundColor: a.color },
                                           active && styles.avatarChoiceActive]}
                                   testID={`avatar-choice-${a.id}`} disabled={savingAvatar}>
                          <Ionicons name={a.icon as any} size={24} color={colors.onDark} />
                          {active && (
                            <View style={styles.avatarCheck}>
                              <Ionicons name="checkmark" size={12} color={colors.ink} />
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                  {savingAvatar && (
                    <ActivityIndicator color={colors.ink} size="small" style={{ marginTop: spacing.sm }} />
                  )}
                </View>
              </Card>
            )}

            {/* SAHIPLIGE gore uc grup. Tur 3'te verilmis iyi bir karar var --
                "bu kime ait?" (bana / eve / uygulamaya) -- ama ekran onu
                GOSTERMIYORDU: baslıksiz tek kartta dort satir vardi ve dordu
                dort farkli sahibe aitti. Grup basliklari kurali gorunur
                yapiyor. Satirlardaki "3 uye", "1 vadesi geldi" gibi ekler bir
                aciklama degil DURUM: girmeden ne oldugunu soyluyor. */}
            <Text style={styles.grup}>SANA AİT</Text>
            <Card>
              {/* Odeme bilgisi burada: kendine ait, cihazda saklaniyor.
                  Ev ayarlarina koymak yanlis olurdu -- ortak degil. */}
              <Pressable style={styles.navRow}
                         onPress={() => router.push("/odeme-bilgilerim")}
                         testID="open-payment-info" android_ripple={{ color: colors.divider }}>
                <IconPill name="card-outline" color={colors.accentDark} tint={colors.accentSoft} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.navTitle}>Ödeme bilgilerim</Text>
                  <Text style={styles.navDesc}>IBAN ve PayPal · telefonunda saklanır</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.inkTertiary} />
              </Pressable>

              <Divider inset={spacing.lg} />
              {/* Hesap AYRI bir kart degil, bu grubun icinde acilir bir satir:
                  ad, e-posta ve sifre sana ait -- eve ya da uygulamaya degil.
                  Ucu de nadir kullaniliyor, o yuzden kapali baslıyor. */}
              <Pressable style={styles.navRow} onPress={() => setHesapAcik((v) => !v)}
                         testID="open-account" android_ripple={{ color: colors.divider }}>
                <IconPill name="person-outline" color={colors.inkSecondary}
                          tint={colors.surfaceSecondary} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.navTitle}>Hesabın</Text>
                </View>
                <Text style={styles.navState}>ad, e-posta, şifre</Text>
                <Ionicons name={hesapAcik ? "chevron-up" : "chevron-down"} size={20}
                          color={colors.inkTertiary} />
              </Pressable>
              {hesapAcik && (
              <>
              {([
                { key: "name", label: "Adını değiştir", value: user?.name, icon: "person-outline" },
                { key: "email", label: "E-postanı değiştir", value: user?.email, icon: "mail-outline" },
                { key: "password", label: "Şifreni değiştir", value: "••••••••", icon: "lock-closed-outline" },
              ] as const).map((row, i) => (
                <View key={row.key}>
                  {i > 0 && <Divider />}
                  <Pressable style={styles.accountRow} onPress={() => openAccount(row.key)}
                             testID={`account-${row.key}`} android_ripple={{ color: colors.divider }}>
                    <View style={styles.accountIcon}>
                      <Ionicons name={row.icon as any} size={18} color={colors.inkSecondary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.accountLabel}>{row.label}</Text>
                      <Text style={styles.accountValue} numberOfLines={1}>{row.value}</Text>
                    </View>
                    <Ionicons name={accountMode === row.key ? "chevron-up" : "chevron-forward"}
                              size={18} color={colors.inkTertiary} />
                  </Pressable>

                  {accountMode === row.key && (
                    <View style={styles.accountForm}>
                      {row.key === "name" && (
                        <TextInput style={styles.accountInput} value={form.name}
                                   onChangeText={(v) => setForm({ ...form, name: v })}
                                   placeholder="Adın" placeholderTextColor={colors.inkTertiary}
                                   autoCapitalize="words" testID="input-name" />
                      )}
                      {row.key === "email" && (
                        <>
                          <TextInput style={styles.accountInput} value={form.email}
                                     onChangeText={(v) => setForm({ ...form, email: v })}
                                     placeholder="Yeni e-posta" placeholderTextColor={colors.inkTertiary}
                                     keyboardType="email-address" autoCapitalize="none"
                                     autoCorrect={false} testID="input-new-email" />
                          <TextInput style={styles.accountInput} value={form.pw}
                                     onChangeText={(v) => setForm({ ...form, pw: v })}
                                     placeholder="Mevcut şifren" placeholderTextColor={colors.inkTertiary}
                                     secureTextEntry autoCapitalize="none" testID="input-email-pw" />
                          <Text style={styles.accountHint}>
                            Şifre soruluyor çünkü açık kalan bir telefonun hesabını başka
                            bir adrese taşımasını istemiyoruz.
                          </Text>
                        </>
                      )}
                      {row.key === "password" && (
                        <>
                          <TextInput style={styles.accountInput} value={form.pw}
                                     onChangeText={(v) => setForm({ ...form, pw: v })}
                                     placeholder="Mevcut şifren" placeholderTextColor={colors.inkTertiary}
                                     secureTextEntry autoCapitalize="none" testID="input-current-pw" />
                          <TextInput style={styles.accountInput} value={form.newPw}
                                     onChangeText={(v) => setForm({ ...form, newPw: v })}
                                     placeholder="Yeni şifre (en az 6 karakter)"
                                     placeholderTextColor={colors.inkTertiary}
                                     secureTextEntry autoCapitalize="none" testID="input-new-pw" />
                          <Text style={styles.accountHint}>
                            Şifreni değiştirince diğer cihazlardaki oturumlar kapanır,
                            bu telefon açık kalır.
                          </Text>
                        </>
                      )}
                      <Pressable style={[styles.accountSave, savingAccount && { opacity: 0.6 }]}
                                 onPress={saveAccount} disabled={savingAccount}
                                 testID={`save-${row.key}`}>
                        {savingAccount
                          ? <ActivityIndicator color={colors.onBrand} size="small" />
                          : <Text style={styles.accountSaveTxt}>Kaydet</Text>}
                      </Pressable>
                    </View>
                  )}
                </View>
              ))}
              </>
              )}
            </Card>

            <Text style={styles.grup}>EVE AİT</Text>
            <Card>
              <Pressable style={styles.navRow} onPress={() => router.push("/ev-ayarlari")}
                         testID="open-household-settings" android_ripple={{ color: colors.divider }}>
                <IconPill name="home" color={colors.accentDark} tint={colors.accentSoft} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.navTitle}>Ev ayarları</Text>
                </View>
                <Text style={styles.navState}>
                  {household ? `${members.length} üye` : "yok"}
                </Text>
                {pendingMembers.length > 0 && isAdmin && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeTxt}>{pendingMembers.length}</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={20} color={colors.inkTertiary} />
              </Pressable>
              <Divider inset={spacing.lg} />
              {/* Düzenli giderlerin TEK kapısı. Ev ayarlarında ikinci bir
                  bağlantı vardı; aynı ekrana iki yerden gitmek "kirayı nereye
                  eklemiştim" sorusunu doğuruyordu. Ev/Kişisel ayrımı zaten
                  ekranın kendi sekmesinde. */}
              <Pressable style={styles.navRow}
                         onPress={() => router.push("/duzenli")}
                         testID="open-recurring" android_ripple={{ color: colors.divider }}>
                <IconPill name="repeat" color={colors.onWarning} tint={colors.warningSoft} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.navTitle}>Düzenli giderler</Text>
                </View>
                {vadesiGelen > 0 && (
                  <Text style={[styles.navState, { color: colors.onWarning }]}>
                    {vadesiGelen} vadesi geldi
                  </Text>
                )}
                <Ionicons name="chevron-forward" size={20} color={colors.inkTertiary} />
              </Pressable>
            </Card>

            <Text style={styles.grup}>UYGULAMA</Text>
            <Card>
              {/* Bildirimler burada: uygulamanin nasil davranacagini
                  belirliyor, ev ya da hesap bilgisi degil. */}
              <Pressable style={styles.navRow} onPress={() => router.push("/bildirimler")}
                         testID="open-notifications" android_ripple={{ color: colors.divider }}>
                <IconPill name="notifications-outline" color={colors.onInfo} tint={colors.infoSoft} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.navTitle}>Bildirimler</Text>
                </View>
                <Text style={styles.navState}>{acikBildirim} açık</Text>
                <Ionicons name="chevron-forward" size={20} color={colors.inkTertiary} />
              </Pressable>
              <Divider inset={spacing.lg} />
              <Pressable style={styles.navRow} onPress={() => router.push("/ayarlar")}
                         testID="open-app-settings" android_ripple={{ color: colors.divider }}>
                <IconPill name="settings-outline" color={colors.onInfo} tint={colors.infoSoft} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.navTitle}>Uygulama ayarları</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.inkTertiary} />
              </Pressable>
            </Card>



            {message && <Text style={styles.message}>{message}</Text>}
            {error && <Text style={styles.errorMsg} testID="settings-error">{error}</Text>}

            <Pressable style={styles.logoutBtn} onPress={logout} testID="logout-btn">
              <Text style={styles.logoutTxt}>Çıkış yap</Text>
            </Pressable>
          </View>
        </Sheet>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  page: { backgroundColor: colors.bg, flexGrow: 1 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginTop: spacing.xs },
  heroEmail: { ...T.body, color: colors.onDarkMuted },
  heroHome: { ...T.captionSb, color: colors.accentOnDark, marginTop: 2 },
  scroll: { padding: spacing.lg, paddingTop: spacing.sm, gap: metrics.cardGap },

  navRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  grup: { ...overline, paddingHorizontal: spacing.xs, marginTop: spacing.md, marginBottom: -4 },
  navState: { ...T.caption, color: colors.inkTertiary },
  navTitle: { ...T.bodySb, color: colors.ink },
  navDesc: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  badge: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.negative,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 5,
  },
  badgeTxt: { color: colors.onDark, fontSize: 10, lineHeight: 14, fontFamily: fontFamily.bold },

  photoOpt: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  photoOptTxt: { ...T.bodySb, color: colors.ink },

  avatarBlock: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  avatarLabel: { ...overline, marginBottom: spacing.md },
  avatarGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  avatarChoice: {
    width: 52, height: 52, borderRadius: 26,
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

  message: { ...T.bodySb, color: colors.accentDark, textAlign: "center" },
  errorMsg: { ...T.bodySb, color: colors.negative, textAlign: "center" },
  logoutBtn: { paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.lg },
  logoutTxt: { ...T.bodySb, color: colors.inkTertiary },
});
