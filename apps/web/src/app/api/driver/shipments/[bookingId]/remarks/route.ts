import { z } from "zod";
import { BookingIdSchema } from "@/lib/api/contracts/common";
import { RemarkBody } from "@/lib/api/contracts/driver";
import { created, handler } from "@/server/http/handler";
import { addRemark } from "@/server/modules/driver/shipments";

/** POST /api/driver/shipments/[bookingId]/remarks — 201 event (visible to customer and agency). */
export const POST = handler(
  { auth: "driver", body: RemarkBody, params: z.object({ bookingId: BookingIdSchema }) },
  async ({ session, params, body, now }) => created(await addRemark(session, params.bookingId, body.text, now)),
);
