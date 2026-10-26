"use server";

import { randomUUID } from "node:crypto";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { mailConfigured, sendMail } from "@/lib/mail/send";

export type DemoState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Partial<Record<"name" | "email" | "company" | "phone", string>>;
  values?: Record<string, string>;
};

const PLANS = new Set(["starter", "growth", "enterprise"]);

/**
 * A request for a demo or a call, from the public site.
 *
 * Saved first, so a lead is never lost to a mail provider being down;
 * the sales inbox is told when one is configured (SALES_EMAIL). The
 * same address asking twice in ten minutes is one request, not two —
 * a double click, or a second try after a slow page.
 */
export async function requestDemo(_prev: DemoState, fd: FormData): Promise<DemoState> {
  const v = (k: string) => String(fd.get(k) ?? "").trim();
  const values = {
    name: v("name"),
    email: v("email").toLowerCase(),
    phone: v("phone"),
    company: v("company"),
    employees: v("employees"),
    plan: v("plan"),
    message: v("message"),
  };

  /* Filled only by bots — the field is hidden from people. */
  if (v("website")) return { ok: true };

  const fieldErrors: DemoState["fieldErrors"] = {};
  if (values.name.length < 2) fieldErrors.name = "Your name, please.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) fieldErrors.email = "A work email we can reply to.";
  if (values.company.length < 2) fieldErrors.company = "Which company is this for?";
  if (values.phone && !/^[+\d][\d\s-]{6,16}$/.test(values.phone)) fieldErrors.phone = "A phone number, or leave it blank.";
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors, values };

  const now = new Date();
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
  try {
    const [recent] = await db
      .select({ id: s.demoRequests.id })
      .from(s.demoRequests)
      .where(and(eq(s.demoRequests.email, values.email), gte(s.demoRequests.createdAt, tenMinutesAgo)))
      .limit(1);
    if (recent) return { ok: true };

    await db.insert(s.demoRequests).values({
      id: randomUUID(),
      name: values.name.slice(0, 120),
      email: values.email.slice(0, 200),
      phone: values.phone || null,
      company: values.company.slice(0, 200),
      employees: values.employees || null,
      plan: PLANS.has(values.plan) ? values.plan : null,
      message: values.message.slice(0, 2000) || null,
      createdAt: now.toISOString(),
    });
  } catch (error) {
    console.error("[demo] could not save request:", error);
    return {
      error: "Your request could not be saved just now. Please try again in a minute.",
      values,
    };
  }

  const salesInbox = process.env.SALES_EMAIL;
  if (salesInbox && mailConfigured()) {
    await sendMail({
      to: salesInbox,
      subject: `Demo request — ${values.company}`,
      text: [
        `${values.name} <${values.email}>${values.phone ? ` · ${values.phone}` : ""}`,
        `Company: ${values.company}${values.employees ? ` · ${values.employees} employees` : ""}`,
        values.plan ? `Plan: ${values.plan}` : "",
        values.message ? `\n${values.message}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    }).catch(() => undefined);
  }

  return { ok: true };
}
