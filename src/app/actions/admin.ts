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
