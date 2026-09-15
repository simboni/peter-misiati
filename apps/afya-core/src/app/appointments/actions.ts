"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth.ts";
import { openClinic, book, cancelAppointment, sendReminders, closeOutDay, markArrived } from "@/lib/scheduling.ts";
import { checkIn } from "@/lib/frontdesk.ts";
import { deviceFor } from "@/app/_components/device.ts";

export async function openClinicAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  openClinic({
    facilityId: user.facilityId,
    providerId: Number(formData.get("providerId")),
    date: String(formData.get("date") ?? ""),
    from: String(formData.get("from") ?? "09:00"),
    to: String(formData.get("to") ?? "13:00"),
    minutes: Number(formData.get("minutes") ?? 15),
    deviceCode: deviceFor(user.deviceCode, user.facilityId),
  });
  revalidatePath("/appointments");
}

export async function bookAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  book({
    slotId: String(formData.get("slotId") ?? ""),
    patientMrn: String(formData.get("mrn") ?? ""),
    reason: String(formData.get("reason") ?? "").trim() || undefined,
    byUserId: user.userId,
    byUserName: user.name,
    deviceCode: deviceFor(user.deviceCode, user.facilityId),
  });
  revalidatePath("/appointments");
}

export async function cancelAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  cancelAppointment({
    appointmentId: String(formData.get("appointmentId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    byUserId: user.userId,
    byUserName: user.name,
  });
  revalidatePath("/appointments");
}

/** Arriving is a check-in: the appointment becomes the visit it was booked for. */
export async function arriveAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const visit = checkIn({
    facilityId: user.facilityId,
    patientMrn: String(formData.get("mrn") ?? ""),
    deviceCode: deviceFor(user.deviceCode, user.facilityId),
    byUserId: user.userId,
    byUserName: user.name,
  });
  markArrived({ appointmentId: String(formData.get("appointmentId") ?? ""), visitId: visit.id });
  revalidatePath("/appointments");
  revalidatePath("/queue");
}

export async function remindAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  sendReminders({ facilityId: user.facilityId, date: String(formData.get("date") ?? "") });
  revalidatePath("/appointments");
}

export async function closeOutAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  closeOutDay({ facilityId: user.facilityId, date: String(formData.get("date") ?? "") });
  revalidatePath("/appointments");
}
