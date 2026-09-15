import { activeDevice, listDevices } from "@/lib/facility.ts";

/**
 * Which device this action is happening on.
 *
 * Every identifier the system mints carries a device prefix so two
 * disconnected desks cannot collide. The session usually knows; when it does
 * not, the first registered device stands in rather than the write failing —
 * a clinic that cannot record a patient because a cookie is thin is worse than
 * one with a slightly wrong prefix.
 */
export function deviceFor(sessionDevice: string | null, facilityId: number): string {
  if (sessionDevice && activeDevice(sessionDevice)) return sessionDevice;
  const devices = listDevices(facilityId).filter((d) => !d.revoked_at);
  if (!devices.length) throw new Error("No device is registered for this facility.");
  return devices[0].code;
}
