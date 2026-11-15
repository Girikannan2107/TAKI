import { handler } from "@/server/http/handler";
import { setPhoto } from "@/server/modules/profile/service";

/** PUT /api/me/photo (multipart: photo) — { photoUrl }. JPEG/PNG/WEBP, 5 MB, checked by magic bytes. */
export const PUT = handler({ auth: ["customer", "agency", "driver"], form: true }, ({ form, session, now }) => setPhoto(session, form!, now));
