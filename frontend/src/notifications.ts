/**
 * Push notification registration.
 *
 * Uses the *device* (FCM) token rather than an Expo push token: Expo's push
 * service needs an EAS project id, and this app is built locally with no Expo
 * account. The backend talks to Firebase directly, so the raw FCM token is
 * exactly what it wants.
 *
 * Everything here fails quietly. Notifications are a convenience; nothing in
 * the app should break because a permission was denied or Google was slow.
 */
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";

import { apiPost } from "./api";

let registeredToken: string | null = null;

// Show a banner even while the app is open — otherwise a roommate adding an
// expense while you are on another screen goes completely unnoticed.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "Genel",
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#0EA5A5",
  });
}

/** Ask permission, get the FCM token, hand it to the backend. Safe to call repeatedly. */
export async function registerForPush(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null; // emulators have no FCM token
    await ensureAndroidChannel();

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return null;

    const { data: token } = await Notifications.getDevicePushTokenAsync();
    if (!token || typeof token !== "string") return null;

    if (token !== registeredToken) {
      await apiPost("/devices/register", { token, platform: Platform.OS });
      registeredToken = token;
    }
    return token;
  } catch (e) {
    console.log("push kaydi basarisiz", e);
    return null;
  }
}

/** Detach this device on logout so the next person doesn't get their pushes. */
export async function unregisterPush(): Promise<void> {
  try {
    if (!registeredToken) return;
    await apiPost("/devices/unregister", { token: registeredToken });
  } catch {
    // Logging out offline is fine — the backend prunes dead tokens anyway.
  } finally {
    registeredToken = null;
  }
}
