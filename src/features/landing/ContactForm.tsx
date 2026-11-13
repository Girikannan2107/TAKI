"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AtSign, CircleAlert, CircleCheck, Send, UserRound } from "lucide-react";
import { Button, FormField, Input, Select, Textarea } from "@/components/ui";
import type { ContactInput as ContactRequest, ContactResultDTO } from "@/lib/api/contracts/common";
import { http, isApiError } from "@/lib/api/http";
import { normalizeIndianMobile } from "@/lib/domain/phone";
import { contactSchema, type ContactInput, type ContactRole, type ContactValues } from "./contact.schema";

const ROLE_OPTIONS: Array<{ value: ContactRole; label: string }> = [
  { value: "customer", label: "I want to ship goods" },
  { value: "agency", label: "I run a travel agency" },
  { value: "driver", label: "I drive for an agency" },
  { value: "other", label: "Something else" },
];

type Status = { kind: "idle" } | { kind: "sent" } | { kind: "error"; message: string };

/** The single "mobile or email" field becomes D5's `phone` or `email` (ContactBody in contracts/common). */
function toRequest(v: ContactValues): ContactRequest {
  const mobile = normalizeIndianMobile(v.reach);
  return {
    name: v.name,
    ...(mobile ? { phone: mobile } : { email: v.reach }),
    role: v.role,
    message: v.message,
    website: v.website || undefined,
  };
}

/** Contact form → POST /api/public/contact. States: sending (button), sent (confirmation), error (alert, values kept). */
export function ContactForm() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ContactInput, unknown, ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: "", reach: "", role: "other", message: "", website: "" },
    mode: "onTouched",
  });

  const onSubmit = async (values: ContactValues) => {
    setStatus({ kind: "idle" });
    try {
      await http.post<ContactResultDTO>("/api/public/contact", toRequest(values));
      reset();
      setStatus({ kind: "sent" });
    } catch (e) {
      if (isApiError(e) && e.fields) {
        const f = e.fields;
        if (f.name) setError("name", { message: f.name });
        if (f.phone || f.email) setError("reach", { message: f.phone ?? f.email });
        if (f.message) setError("message", { message: f.message });
      }
      setStatus({
        kind: "error",
        message:
          isApiError(e) && e.code === "rate_limited"
            ? "You've sent several messages already. Please wait a while before sending another."
            : isApiError(e) && e.status < 500 && e.status !== 0
              ? e.message
              : "Your message wasn't sent. Check your connection and try again.",
      });
    }
  };

  if (status.kind === "sent") {
    return (
      <div role="status" className="flex flex-col items-start gap-4">
        <span className="flex size-12 items-center justify-center rounded-full bg-mint-100 text-green-700">
          <CircleCheck aria-hidden="true" className="size-6" />
        </span>
        <div>
          <h3 className="type-h3 text-ink">Message sent</h3>
          <p className="mt-1 text-[15px] leading-6 text-ink-muted">Thanks for writing to TAKI. We&apos;ll reply on the mobile number or email you gave us.</p>
        </div>
        <Button variant="outline" onClick={() => setStatus({ kind: "idle" })}>
          Send another message
        </Button>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} aria-labelledby="contact-form-title" className="flex flex-col gap-4">
      <h3 id="contact-form-title" className="type-h3 text-ink">
        Send us a message
      </h3>
      {status.kind === "error" ? (
        <p role="alert" className="flex items-start gap-2.5 rounded-md border border-error/20 bg-danger-100 px-4 py-3 text-sm font-medium text-error">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {status.message}
        </p>
      ) : null}
      <FormField label="Name" htmlFor="contact-name" error={errors.name?.message} required>
        <Input leadingIcon={<UserRound />} autoComplete="name" placeholder="Your name" {...register("name")} />
      </FormField>
      <FormField
        label="Mobile or email"
        htmlFor="contact-reach"
        hint="A 10-digit mobile number or an email address."
        error={errors.reach?.message}
        required
      >
        <Input leadingIcon={<AtSign />} autoComplete="email" placeholder="98765 43210 or you@example.com" {...register("reach")} />
      </FormField>
      <FormField label="About you" htmlFor="contact-role" error={errors.role?.message}>
        <Select options={ROLE_OPTIONS} {...register("role")} />
      </FormField>
      <FormField label="Message" htmlFor="contact-message" error={errors.message?.message} required>
        <Textarea rows={5} maxLength={1000} showCount placeholder="How can we help?" {...register("message")} />
      </FormField>
      {/* Honeypot: off-screen and skipped by keyboard and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] size-px overflow-hidden">
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" type="text" tabIndex={-1} autoComplete="off" {...register("website")} />
      </div>
      <Button
        type="submit"
        size="lg"
        loading={isSubmitting}
        trailingIcon={<Send className="size-[18px]" />}
        className="mt-1 w-full sm:w-auto sm:self-start"
      >
        {isSubmitting ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
