const CAMERA_DEVICE_KEY = "local-avatar-rig:face-tracking-camera";

export function getStoredCameraDeviceId() {
  try {
    return window.localStorage.getItem(CAMERA_DEVICE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStoredCameraDeviceId(deviceId: string) {
  try {
    if (deviceId) window.localStorage.setItem(CAMERA_DEVICE_KEY, deviceId);
    else window.localStorage.removeItem(CAMERA_DEVICE_KEY);
  } catch {
    // Storage can be unavailable in strict private-browsing modes. The current
    // session still works with the browser-selected default camera.
  }
}

export async function listVideoInputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "videoinput")
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `カメラ ${index + 1}`,
    }));
}
