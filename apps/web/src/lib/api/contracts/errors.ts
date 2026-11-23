/**
 * Error codes the FastAPI backend returns, with their HTTP status and the default user-facing message
 * (used when a response carries a code but no message, and by `messageForCode`).
 *
 * Wire format of every error response:
 *   { error: { code: string, message: string, fields?: Record<string, string>, details?: Record<string, unknown> } }
 */

export const ERROR_CATALOG = {
  // 400
  invalid_request: { status: 400, message: "Some details are missing or invalid. Please check and try again." },
  idempotency_key_required: { status: 400, message: "This request needs an Idempotency-Key header." },
  // 401
  unauthenticated: { status: 401, message: "Please sign in to continue." },
  invalid_credentials: { status: 401, message: "Phone number or password is incorrect." },
  invalid_signature: { status: 401, message: "Invalid signature." },
  stale_timestamp: { status: 401, message: "Request timestamp is too old." },
  // 403
  forbidden: { status: 403, message: "You don't have access to this." },
  bad_origin: { status: 403, message: "Request origin not allowed." },
  agency_not_verified: { status: 403, message: "Your agency must be verified before you can do this." },
  driver_not_linked: { status: 403, message: "You are not linked to an active agency yet." },
  account_disabled: { status: 403, message: "This account has been disabled. Contact support." },
  // 404
  not_found: { status: 404, message: "We couldn't find that." },
  // 409
  conflict: { status: 409, message: "This was changed by someone else. Refresh and try again." },
  contention: { status: 409, message: "Too many people are updating this right now. Please try again." },
  already_exists: { status: 409, message: "This already exists." },
  invalid_transition: { status: 409, message: "This action is no longer available for this booking." },
  insufficient_capacity: { status: 409, message: "Not enough capacity left on this trip." },
  shipment_has_open_booking: { status: 409, message: "This shipment already has an open booking request." },
  already_paid: { status: 409, message: "This booking is already paid." },
  already_reviewed: { status: 409, message: "You have already reviewed this delivery." },
  driver_schedule_conflict: { status: 409, message: "The driver is already assigned to another trip at that time." },
  vehicle_schedule_conflict: { status: 409, message: "The vehicle is already booked for another trip at that time." },
  driver_unavailable: { status: 409, message: "This driver is not available for trips." },
  vehicle_unavailable: { status: 409, message: "This vehicle is not active." },
  phone_taken: { status: 409, message: "This phone number is already registered. Please log in." },
  registration_taken: { status: 409, message: "A vehicle with this registration number already exists." },
  trip_has_bookings: { status: 409, message: "This trip has active bookings, so this change isn't allowed." },
  trip_not_bookable: { status: 409, message: "This trip is no longer accepting bookings." },
  driver_has_active_trips: { status: 409, message: "This driver is assigned to upcoming or active trips." },
  vehicle_has_active_trips: { status: 409, message: "This vehicle is assigned to upcoming or active trips." },
  checkpoint_out_of_order: { status: 409, message: "Update checkpoints in route order." },
  undelivered_shipments: { status: 409, message: "Deliver or close every shipment before completing the trip." },
  otp_not_exhausted: { status: 409, message: "The current code is still valid." },
  // 410
  otp_expired: { status: 410, message: "This code has expired. Request a new one." },
  proof_expired: { status: 410, message: "Verification expired. Please verify your phone again." },
  payment_window_closed: { status: 410, message: "The payment window for this booking has closed." },
  request_expired: { status: 410, message: "This booking request has expired." },
  // 413 / 415
  file_too_large: { status: 413, message: "That file is too large." },
  unsupported_media_type: { status: 415, message: "Unsupported content type." },
  // 422
  not_on_route: { status: 422, message: "This trip doesn't pass through your pickup and drop districts in order." },
  goods_not_accepted: { status: 422, message: "This trip doesn't accept these goods." },
  handling_not_supported: { status: 422, message: "This trip can't provide the special handling you need." },
  package_too_heavy: { status: 422, message: "Your package is heavier than this trip allows per package." },
  departed: { status: 422, message: "This trip has already left your pickup point." },
  otp_invalid: { status: 422, message: "That code is incorrect." },
  too_many_attempts: { status: 422, message: "Too many incorrect attempts." },
  too_many_resends: { status: 422, message: "You've requested too many codes." },
  idempotency_key_reused: { status: 422, message: "This request key was already used for a different request." },
  pincode_state_mismatch: { status: 422, message: "The pincode doesn't belong to the selected state." },
  district_state_mismatch: { status: 422, message: "The district doesn't belong to the selected state." },
  outside_service_area: { status: 422, message: "TAKI currently serves Tamil Nadu, Kerala, Karnataka, Telangana and Andhra Pradesh." },
  past_date: { status: 422, message: "Choose today or a later date." },
  date_too_far: { status: 422, message: "Choose a date within the next 60 days." },
  too_early: { status: 422, message: "It's too early for this step." },
  proof_required: { status: 422, message: "Add at least one delivery photo." },
  underage: { status: 422, message: "You must be at least 18 years old." },
  invalid_document_number: { status: 422, message: "That document number doesn't look right." },
  file_invalid: { status: 422, message: "That file type isn't supported." },
  invalid_checkpoints: { status: 422, message: "Check the route checkpoints and their timings." },
  capacity_exceeds_vehicle: { status: 422, message: "Offered capacity can't exceed the vehicle's payload." },
  capacity_below_booked: { status: 422, message: "Offered capacity can't be lower than what is already booked." },
  amount_mismatch: { status: 422, message: "The paid amount doesn't match the booking total." },
  // 423 / 429
  account_locked: { status: 423, message: "Too many failed attempts. Try again later." },
  rate_limited: { status: 429, message: "Too many requests. Please wait and try again." },
  resend_cooldown: { status: 429, message: "Please wait before requesting another code." },
  // 5xx
  internal: { status: 500, message: "Something went wrong on our side. Please try again." },
  not_implemented: { status: 501, message: "This feature is not available yet." },
  payments_not_configured: { status: 501, message: "Online payments are not configured for this deployment." },
  sms_not_configured: { status: 503, message: "SMS is not configured for this deployment." },
  database_unavailable: { status: 503, message: "We can't reach our database right now. Please try again in a moment." },
  cron_not_configured: { status: 503, message: "The scheduled sweep is not configured for this deployment." },
  gateway_error: { status: 502, message: "The payment gateway didn't respond. Please try again." },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

/** JSON body of an error response. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    details?: Record<string, unknown>;
  };
}

export function isKnownErrorCode(code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CATALOG, code);
}

export function messageForCode(code: string): string {
  return isKnownErrorCode(code) ? ERROR_CATALOG[code].message : ERROR_CATALOG.internal.message;
}
