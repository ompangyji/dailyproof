"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * 실패/stuck job 재처리. 권한 검증은 DB의 admin_requeue_job 이 SECURITY DEFINER 안에서
 * is_admin()으로 재수행하므로(앱 레이어만 믿지 않음), 여기서는 로그인만 확인하고 RPC를 호출한다.
 * 비-admin이 직접 이 액션을 호출해도 DB에서 forbidden으로 막힌다.
 */
export async function requeueJobAction(formData: FormData) {
  const jobId = String(formData.get("job_id") ?? "").trim();
  if (!jobId) throw new Error("job_id 누락");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("admin_requeue_job", { p_job_id: jobId });
  if (error) throw new Error(`재처리 실패: ${error.message}`);

  revalidatePath("/admin/ops");
}

/**
 * 영구 실패(poison) job을 dead로 종결한다. transient는 재처리로 풀리지만 원본 파일 없음/손상
 * 같은 permanent 실패는 재처리해도 무한 반복되므로 운영자가 사유와 함께 포기 처리한다.
 * 권한·사유 검증은 DB의 admin_dead_letter_job 안에서 수행된다.
 */
export async function deadLetterJobAction(formData: FormData) {
  const jobId = String(formData.get("job_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!jobId) throw new Error("job_id 누락");
  if (!reason) throw new Error("포기 사유를 입력하세요");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("admin_dead_letter_job", {
    p_job_id: jobId,
    p_reason: reason,
  });
  if (error) throw new Error(`dead-letter 실패: ${error.message}`);

  revalidatePath("/admin/ops");
}
