"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AtSign, Send, UserRound } from "lucide-react";
import { Button, FormField, Input, useToast } from "@/components/ui";
import { contactSchema, type ContactInput, type ContactValues } from "./contact.schema";

const textareaClasses = [
  "block min-h-32 w-full resize-y rounded-md border border-border bg-surface px-3.5 py-3 text-base leading-6 text-ink",
  "placeholder:text-ink-subtle transition-[border-color] duration-150 hover:border-border-strong",
  "focus-visible:border-green-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700",
  "aria-invalid:border-error aria-invalid:outline-error",
].join(" ");

/** Demo contact form: validates with zod, then shows a toast saying nothing was sent (there is no backend). */
export function ContactForm() {
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactInput, unknown, ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: "", reach: "", message: "" },
    mode: "onTouched",
  });

  const onSubmit = () => {
    toast({
      title: "Demo — your message was not sent",
      description: "TAKI Travel is a demo without a backend, so contact messages aren't delivered anywhere.",
      tone: "info",
      durationMs: 6000,
    });
    reset();
  };

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} aria-labelledby="contact-form-title" className="flex flex-col gap-4">
      <h3 id="contact-form-title" className="type-h3 text-ink">
        Send us a message
      </h3>
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
      <FormField label="Message" htmlFor="contact-message" error={errors.message?.message} required>
        <textarea rows={5} placeholder="How can we help?" className={textareaClasses} {...register("message")} />
      </FormField>
      <Button type="submit" size="lg" trailingIcon={<Send className="size-[18px]" />} className="mt-1 w-full sm:w-auto sm:self-start">
        Send message
      </Button>
      <p className="text-[13px] leading-5 text-ink-subtle">Demo only: messages are not sent or stored.</p>
    </form>
  );
}
