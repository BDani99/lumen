"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { safeNext } from "@/lib/safe-next";

function authErrorHu(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials")) {
    return "Hibás email vagy jelszó.";
  }
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "Ez az email cím már regisztrálva van.";
  }
  if (m.includes("password") && m.includes("least")) {
    return "A jelszónak legalább 6 karakternek kell lennie.";
  }
  if (m.includes("email")) {
    return "Érvénytelen email cím.";
  }
  return message;
}

export async function login(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    redirect(`/login?message=${encodeURIComponent("Add meg az emailt és a jelszót.")}`);
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const nextQ = formData.get("next");
    const nextParam =
      typeof nextQ === "string" && nextQ
        ? `&next=${encodeURIComponent(safeNext(nextQ))}`
        : "";
    redirect(
      `/login?message=${encodeURIComponent(authErrorHu(error.message))}${nextParam}`
    );
  }

  revalidatePath("/", "layout");
  redirect(safeNext(String(formData.get("next") || "/")));
}

export async function signup(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");

  if (!email || !password) {
    redirect(`/register?message=${encodeURIComponent("Add meg az emailt és a jelszót.")}`);
  }
  if (password.length < 8) {
    redirect(
      `/register?message=${encodeURIComponent("A jelszónak legalább 8 karakternek kell lennie.")}`
    );
  }
  if (password !== confirm) {
    redirect(`/register?message=${encodeURIComponent("A két jelszó nem egyezik.")}`);
  }

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    redirect(`/register?message=${encodeURIComponent(authErrorHu(error.message))}`);
  }

  // Email confirmation enabled → no session yet
  if (!data.session) {
    redirect(
      `/login?message=${encodeURIComponent(
        "Sikeres regisztráció. Erősítsd meg az emailed a kapott linkkel, majd jelentkezz be."
      )}`
    );
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function updatePassword(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");

  if (password.length < 8) {
    redirect(
      `/account?message=${encodeURIComponent("A jelszónak legalább 8 karakternek kell lennie.")}&type=error`
    );
  }
  if (password !== confirm) {
    redirect(`/account?message=${encodeURIComponent("A két jelszó nem egyezik.")}&type=error`);
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    redirect(
      `/account?message=${encodeURIComponent(authErrorHu(error.message))}&type=error`
    );
  }

  revalidatePath("/", "layout");
  redirect(
    `/account?message=${encodeURIComponent("Jelszó sikeresen frissítve.")}&type=success`
  );
}
