"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2 } from "lucide-react";

const schema = z.object({
  name: z.string().min(2, "Please enter your name"),
  email: z.string().email("Please enter a valid email address"),
  organisation: z.string().optional().or(z.literal("")),
  topic: z.enum(["evaluation", "technical", "partnership", "other"], {
    errorMap: () => ({ message: "Please choose a topic" }),
  }),
  message: z.string().min(20, "Please give at least 20 characters of detail"),
  noPhi: z.literal(true, {
    errorMap: () => ({ message: "Please confirm you will not send identifiable health data" }),
  }),
});

type FormValues = z.infer<typeof schema>;

export function ContactForm() {
  const [submitted, setSubmitted] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { topic: "evaluation", noPhi: undefined as unknown as true },
  });

  const onSubmit = async (values: FormValues) => {
    // No provider is configured, so nothing is transmitted. We record the
    // submission locally and state that plainly instead of faking delivery.
    await new Promise((r) => setTimeout(r, 400));
    try {
      const key = "vaxbridge_contact_enquiries";
      const existing = JSON.parse(localStorage.getItem(key) || "[]");
      existing.push({ ...values, recorded_at: new Date().toISOString() });
      localStorage.setItem(key, JSON.stringify(existing));
    } catch {
      // storage unavailable; the visible confirmation still stands
    }
    setSubmitted(true);
    reset();
  };

  if (submitted) {
    return (
      <div
        className="mt-5 rounded-lg border border-mint/30 bg-mint/5 p-6"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-mint" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-semibold text-text">Enquiry recorded locally</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-text-secondary/85">
              Your enquiry passed validation and was saved in this browser. It was <strong className="text-text">not
              transmitted</strong>, because no email or messaging provider is configured in this prototype. A production
              deployment would route it through a configured notification adapter and report real delivery status.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => setSubmitted(false)}>
              Record another enquiry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-5 space-y-5 rounded-lg border border-border bg-surface/50 p-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Your name" error={errors.name?.message} htmlFor="name" required>
          <Input id="name" autoComplete="name" {...register("name")} />
        </Field>
        <Field label="Email" error={errors.email?.message} htmlFor="email" required>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Organisation (optional)" error={errors.organisation?.message} htmlFor="organisation">
          <Input id="organisation" autoComplete="organization" {...register("organisation")} />
        </Field>
        <Field label="Topic" error={errors.topic?.message} htmlFor="topic" required>
          <select
            id="topic"
            className="block w-full rounded-md border border-border bg-navy-secondary text-sm text-text transition-colors focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan"
            {...register("topic")}
          >
            <option value="evaluation">Evaluating the product</option>
            <option value="technical">Technical question</option>
            <option value="partnership">Deployment or partnership</option>
            <option value="other">Other</option>
          </select>
        </Field>
      </div>

      <Field label="Message" error={errors.message?.message} htmlFor="message" required>
        <Textarea id="message" rows={5} placeholder="Describe what you would like to evaluate or discuss." {...register("message")} />
      </Field>

      <div>
        <label htmlFor="noPhi" className="flex items-start gap-3 text-sm text-text-secondary">
          <input
            id="noPhi"
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-navy-secondary accent-[#38D9FF]"
            {...register("noPhi")}
          />
          <span>
            I understand this is a prototype and I will not include real patient information or identifiable health data.
            {errors.noPhi && (
              <span className="mt-1 flex items-center gap-1.5 text-xs text-red-400">
                <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                {errors.noPhi.message}
              </span>
            )}
          </span>
        </label>
      </div>

      <div className="flex items-center gap-4">
        <Button variant="primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Validating…" : "Record enquiry"}
        </Button>
        <p className="text-xs text-text-secondary/60">Nothing is sent to an external service.</p>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  htmlFor,
  required,
  children,
}: {
  label: string;
  error?: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-text-secondary">
        {label}
        {required && <span className="ml-1 text-cyan" aria-hidden="true">*</span>}
      </label>
      {children}
      {error && (
        <p id={`${htmlFor}-error`} className="mt-1.5 flex items-center gap-1.5 text-xs text-red-400" role="alert">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
