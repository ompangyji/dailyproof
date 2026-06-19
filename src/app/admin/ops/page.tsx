import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requeueJobAction } from "@/app/actions/admin";

// 운영 데이터(실패/stuck job, orphan)는 매 요청 최신이어야 한다.
export const dynamic = "force-dynamic";

type FailedJob = {
  job_id: string;
  asset_id: string;
  user_id: string;
  type: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  asset_status: string;
  error_code: string | null;
  source_path: string;
  updated_at: string;
};

type StuckJob = {
  job_id: string;
  asset_id: string;
  user_id: string;
  attempts: number;
  locked_by: string | null;
  locked_at: string;
  minutes_stuck: number;
};

type Orphan = {
  object_name: string;
  size_bytes: number | null;
  created_at: string;
};

function fmt(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("ko-KR");
}

function RequeueButton({ jobId }: { jobId: string }) {
  return (
    <form action={requeueJobAction}>
      <input type="hidden" name="job_id" value={jobId} />
      <button
        type="submit"
        className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
      >
        재처리
      </button>
    </form>
  );
}

export default async function AdminOpsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 다층 인가 1단계: 페이지 진입 게이트. 비-admin에겐 페이지 존재 자체를 숨긴다(404).
  // (DB 함수도 SECURITY DEFINER 안에서 is_admin()을 재검증한다 — 2단계.)
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  const [failedRes, stuckRes, orphanRes] = await Promise.all([
    supabase.rpc("admin_failed_jobs", { p_limit: 100 }),
    supabase.rpc("admin_stuck_jobs", { p_minutes: 5 }),
    supabase.rpc("admin_orphans", { p_limit: 100 }),
  ]);

  const failed = (failedRes.data ?? []) as FailedJob[];
  const stuck = (stuckRes.data ?? []) as StuckJob[];
  const orphans = (orphanRes.data ?? []) as Orphan[];

  return (
    <main className="mx-auto max-w-6xl space-y-10 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">운영 콘솔 (admin ops)</h1>
        <p className="text-sm text-gray-500">
          실패·정체(stuck) 작업과 고아(orphan) 파일을 조회하고 재처리한다. 권한은 서버(DB)에서 강제된다.
        </p>
      </header>

      {/* 실패 작업 */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          실패한 작업 <span className="text-gray-400">({failed.length})</span>
        </h2>
        {failed.length === 0 ? (
          <p className="text-sm text-gray-500">실패한 작업이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-gray-500">
                <tr>
                  <th className="py-2 pr-3">job</th>
                  <th className="py-2 pr-3">시도</th>
                  <th className="py-2 pr-3">error_code</th>
                  <th className="py-2 pr-3">last_error</th>
                  <th className="py-2 pr-3">갱신</th>
                  <th className="py-2 pr-3">작업</th>
                </tr>
              </thead>
              <tbody>
                {failed.map((j) => (
                  <tr key={j.job_id} className="border-b align-top">
                    <td className="py-2 pr-3 font-mono text-xs">{j.job_id.slice(0, 8)}</td>
                    <td className="py-2 pr-3">{j.attempts}/{j.max_attempts}</td>
                    <td className="py-2 pr-3">{j.error_code ?? "—"}</td>
                    <td className="py-2 pr-3 max-w-xs truncate" title={j.last_error ?? ""}>
                      {j.last_error ?? "—"}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmt(j.updated_at)}</td>
                    <td className="py-2 pr-3"><RequeueButton jobId={j.job_id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 정체(stuck) 작업 */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          정체된 작업 (stuck, 5분+ processing) <span className="text-gray-400">({stuck.length})</span>
        </h2>
        {stuck.length === 0 ? (
          <p className="text-sm text-gray-500">정체된 작업이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-gray-500">
                <tr>
                  <th className="py-2 pr-3">job</th>
                  <th className="py-2 pr-3">시도</th>
                  <th className="py-2 pr-3">locked_by</th>
                  <th className="py-2 pr-3">선점 시각</th>
                  <th className="py-2 pr-3">정체(분)</th>
                  <th className="py-2 pr-3">작업</th>
                </tr>
              </thead>
              <tbody>
                {stuck.map((j) => (
                  <tr key={j.job_id} className="border-b">
                    <td className="py-2 pr-3 font-mono text-xs">{j.job_id.slice(0, 8)}</td>
                    <td className="py-2 pr-3">{j.attempts}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{j.locked_by ?? "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmt(j.locked_at)}</td>
                    <td className="py-2 pr-3">{j.minutes_stuck}</td>
                    <td className="py-2 pr-3"><RequeueButton jobId={j.job_id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* orphan objects (참조 없는 media 파일) */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          orphan objects <span className="text-gray-400">({orphans.length})</span>
        </h2>
        <p className="text-xs text-gray-400">
          스토리지(media 버킷)엔 있으나 어떤 proof_assets도 참조하지 않는 파일 — 업로드 직후 레코드 생성
          실패나 자산 삭제 후 파일 잔존으로 남는 미참조(unreferenced/dangling) 객체. 정리는 수동 검토 후
          진행한다(여기서는 확인만).
        </p>
        {orphans.length === 0 ? (
          <p className="text-sm text-gray-500">orphan object가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-gray-500">
                <tr>
                  <th className="py-2 pr-3">경로</th>
                  <th className="py-2 pr-3">크기(byte)</th>
                  <th className="py-2 pr-3">생성</th>
                </tr>
              </thead>
              <tbody>
                {orphans.map((o) => (
                  <tr key={o.object_name} className="border-b">
                    <td className="py-2 pr-3 font-mono text-xs">{o.object_name}</td>
                    <td className="py-2 pr-3">{o.size_bytes ?? "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmt(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
