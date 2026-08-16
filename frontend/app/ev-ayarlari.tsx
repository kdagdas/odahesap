/** Ev ayarları — ortak olan her şey.
 *
 *  Profil tek bir yığındı: fotoğraf, ev adı, davet kodu, onay bekleyenler,
 *  üye yönetimi, hesap bilgileri, bildirimler, çıkış. Beş ayrı işin tek
 *  ekranda toplanması "neyi nerede bulacağım" sorusunu doğuruyordu.
 *
 *  Kural: kime ait olduğuna göre ayır. Burası EVE ait olan.
 */
import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, Share, Platform,
  ActivityIndicator, TextInput, Alert,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import { apiPost, api } from "@/src/api";
import { Avatar, Card, Divider, ScreenHeader, Sheet, Tag, useScrollPad } from "@/src/ui";
import { colors, spacing, radius, type as T, overline, metrics, fontFamily } from "@/src/theme";

export default function EvAyarlari() {
  // Gezinme cubugu payi -- ic dolgu zaten var, buraya yalnizca cihazin payi.
  const altPay = useScrollPad({ extra: 0 });
  const router = useRouter();
  const { user } = useAuth();
  const {
    household, members, pendingMembers, isAdmin, adminId, openExpenseCount, refresh,
  } = useHousehold();

  const [busy, setBusy] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [transferTo, setTransferTo] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [regenConfirm, setRegenConfirm] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Katılma istekleri uygulama açıkken geliyor; odağa dönünce tazelenmezse
  // yönetici onları ancak yeniden başlatınca görüyor.
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

  const doApprove = async (userId: string, includeOpen: boolean) => {
    setBusy(userId);
    try {
      await apiPost("/households/approve", { user_id: userId, include_open_period: includeOpen });
      await refresh();
    } finally { setBusy(null); }
  };

  /**
   * Bölüşme listesi kayıt anında donuyor, yani yeni üye kendiliğinden geçmiş
   * harcamalara girmiyor. Ama gerçek durum bunun tersi olabiliyor: kişi dönem
   * başından beri evde, uygulamaya sonradan katıldı. Karar sorulmalı — sessiz
   * bir varsayım iki yönde de yanlış borç üretir.
   */
  const approve = (userId: string, name: string) => {
    if (openExpenseCount <= 0) { doApprove(userId, false); return; }
    Alert.alert(
      `${name.split(" ")[0]} eve katılıyor`,
      `Açık dönemde ${openExpenseCount} ev harcaması var. Bunların payını da üstlensin mi?`,
      [
        { text: "Vazgeç", style: "cancel" },
        { text: "Sadece bundan sonrası", onPress: () => doApprove(userId, false) },
        { text: `${openExpenseCount} harcamaya da kat`, onPress: () => doApprove(userId, true) },
      ],
    );
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

  if (!household) {
    return (
      <View style={styles.root} testID="ev-ayarlari-screen">
        <ScreenHeader overline="EV" title="Ev Ayarları" />
        <Sheet>
          <Text style={styles.warnTxt}>Henüz bir eve bağlı değilsin.</Text>
        </Sheet>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="ev-ayarlari-screen">
      <ScrollView contentContainerStyle={[styles.page, altPay]} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline="EV"
          title={household.name}
          right={
            <Pressable onPress={() => router.back()} hitSlop={12} testID="ev-back" style={styles.headBtn}>
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        >
          <Text style={styles.heroSub}>
            {members.length} üye · {household.currency === "TRY" ? "₺ Türk lirası" : "€ Euro"}
          </Text>
        </ScreenHeader>

        <Sheet>
          <View style={styles.scroll}>
            {pendingMembers.length > 0 && !isAdmin && (
              <View style={styles.infoBox}>
                <Ionicons name="information-circle" size={16} color={colors.accentDark} />
                <Text style={styles.infoTxt}>
                  {pendingMembers.length} kişi katılmayı bekliyor. Onaylama yetkisi ev yöneticisinde.
                </Text>
              </View>
            )}

            {pendingMembers.length > 0 && isAdmin && (
              <Card title={`Onay Bekleyenler (${pendingMembers.length})`}>
                {openExpenseCount > 0 && (
                  <View style={styles.warnBox} testID="mid-period-join-warning">
                    <Ionicons name="information-circle" size={16} color={colors.onWarning} />
                    <Text style={styles.warnBoxTxt}>
                      Açık dönemde {openExpenseCount} ev harcaması var. Onaylarken yeni üyenin
                      bunların payını üstlenip üstlenmeyeceği sorulacak.
                    </Text>
                  </View>
                )}
                {pendingMembers.map((p, i) => (
                  <View key={p.user_id} testID={`pending-row-${p.user_id}`}>
                    {i > 0 && <Divider />}
                    <View style={styles.personRow}>
                      <Avatar name={p.name} size={38} avatarId={(p as any).avatar_id}
                              userId={p.user_id} photoVersion={(p as any).photo_version} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.memberName}>{p.name}</Text>
                        <Text style={styles.email}>{p.email}</Text>
                      </View>
                      {busy === p.user_id ? (
                        <ActivityIndicator color={colors.dark} />
                      ) : (
                        <View style={styles.pendingActions}>
                          <Pressable style={styles.rejectBtn} onPress={() => reject(p.user_id)}
                                     testID={`reject-${p.user_id}`}>
                            <Ionicons name="close" size={18} color={colors.negative} />
                          </Pressable>
                          <Pressable style={styles.approveBtn} onPress={() => approve(p.user_id, p.name)}
                                     testID={`approve-${p.user_id}`}>
                            <Ionicons name="checkmark" size={18} color={colors.onDark} />
                          </Pressable>
                        </View>
                      )}
                    </View>
                  </View>
                ))}
              </Card>
            )}

            <Card title="Ev Adı ve Davet" padded>
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
                    <Pressable style={styles.nameCancel}
                               onPress={() => { setEditingName(false); setMessage(null); }}
                               testID="cancel-rename">
                      <Text style={styles.nameCancelTxt}>Vazgeç</Text>
                    </Pressable>
                    <Pressable style={[styles.nameSave, savingName && { opacity: 0.6 }]}
                               onPress={saveName} disabled={savingName} testID="save-rename">
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
                    <Pressable onPress={() => { setNameDraft(household.name); setEditingName(true); }}
                               hitSlop={10} testID="edit-household-name">
                      <Ionicons name="pencil" size={18} color={colors.accentDark} />
                    </Pressable>
                  )}
                </View>
              )}

              <View style={styles.inviteBox}>
                <Text style={styles.inviteLabel}>DAVET KODU</Text>
                <Text style={styles.inviteCode} testID="invite-code-display">
                  {household.invite_code}
                </Text>
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
                      <Avatar name={m.name} size={38} avatarId={(m as any).avatar_id}
                              userId={m.user_id} photoVersion={(m as any).photo_version} />
                      <View style={{ flex: 1 }}>
                        <View style={styles.memberNameRow}>
                          <Text style={styles.memberName}>
                            {m.name}{m.user_id === user?.user_id ? " (sen)" : ""}
                          </Text>
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
                            <Pressable onPress={() => setTransferTo(null)} hitSlop={8}
                                       testID={`cancel-transfer-${m.user_id}`}>
                              <Text style={styles.cancelSmall}>Vazgeç</Text>
                            </Pressable>
                            <Pressable style={styles.confirmSmall} onPress={() => doTransfer(m.user_id)}
                                       testID={`confirm-transfer-${m.user_id}`}>
                              <Text style={styles.confirmSmallTxt}>Onayla</Text>
                            </Pressable>
                          </View>
                        ) : removeTarget === m.user_id ? (
                          <View style={styles.confirmRow}>
                            <Pressable onPress={() => setRemoveTarget(null)} hitSlop={8}
                                       testID={`cancel-remove-${m.user_id}`}>
                              <Text style={styles.cancelSmall}>Vazgeç</Text>
                            </Pressable>
                            <Pressable style={styles.removeConfirm}
                                       onPress={() => doRemove(m.user_id, m.name)}
                                       testID={`confirm-remove-${m.user_id}`}>
                              <Text style={styles.confirmSmallTxt}>Çıkar</Text>
                            </Pressable>
                          </View>
                        ) : (
                          <View style={styles.actionsCol}>
                            <Pressable
                              onPress={() => { setTransferTo(m.user_id); setRemoveTarget(null); setMessage(null); setError(null); }}
                              hitSlop={6} testID={`transfer-admin-${m.user_id}`}>
                              <Text style={styles.transferLink}>Yönetici yap</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => { setRemoveTarget(m.user_id); setTransferTo(null); setMessage(null); setError(null); }}
                              hitSlop={6} testID={`remove-member-${m.user_id}`}>
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

            <Pressable style={styles.leaveBtn} onPress={leave} testID="leave-household-btn">
              <Ionicons name="exit-outline" size={18} color={colors.negative} />
              <Text style={styles.leaveTxt}>Evden ayrıl</Text>
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
  headBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  heroSub: { ...T.body, color: colors.onDarkMuted, marginTop: spacing.xs },
  scroll: { padding: spacing.lg, paddingTop: spacing.sm, gap: metrics.cardGap, paddingBottom: spacing.xxxl },
  email: { ...T.caption, color: colors.inkTertiary },

  personRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  memberName: { ...T.bodySb, color: colors.ink },
  memberNameRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  pendingActions: { flexDirection: "row", gap: spacing.sm },
  approveBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  rejectBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.negativeSoft, alignItems: "center", justifyContent: "center" },

  homeNameRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  // Kart başlığıyla aynı punto ve renkteydi, ikisi tek satır gibi okunuyordu.
  // Yeşil, "bu bir başlık değil, senin girdiğin veri" diyor.
  homeName: { ...T.emph, color: colors.accentDark, flex: 1 },
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

  errorMsg: { ...T.bodySb, color: colors.negative, textAlign: "center" },
  message: { ...T.bodySb, color: colors.accentDark, textAlign: "center" },
  warnTxt: { ...T.caption, color: colors.inkSecondary, lineHeight: 18, paddingHorizontal: spacing.xs },
  infoBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.accentSoft, padding: spacing.md, borderRadius: radius.md,
  },
  infoTxt: { flex: 1, ...T.caption, color: colors.accentDark, lineHeight: 18 },
  warnBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: colors.warningSoft, padding: spacing.md,
    marginHorizontal: spacing.lg, marginBottom: spacing.sm, borderRadius: radius.md,
  },
  warnBoxTxt: { flex: 1, ...T.caption, color: colors.onWarning, lineHeight: 18 },

  nameInput: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 16, fontFamily: fontFamily.regular, color: colors.ink, minHeight: 50,
  },
  nameCancel: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  nameCancelTxt: { ...T.bodySb, color: colors.inkSecondary },
  nameSave: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.brand, minHeight: 44 },
  nameSaveTxt: { ...T.bodySb, color: colors.onBrand },

  leaveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 1, borderColor: colors.negative, borderRadius: radius.pill,
    paddingVertical: spacing.md, minHeight: 50, marginTop: spacing.lg,
  },
  leaveTxt: { ...T.bodySb, color: colors.negative },
});
