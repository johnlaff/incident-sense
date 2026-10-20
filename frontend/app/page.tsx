import { redirect } from "next/navigation";

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  // The incident queue is the home of the workspace. Keep the query string so
  // a shared link like /?aula=1 still opens the lesson mode.
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, v);
    }
  }
  const query = params.toString();
  redirect(query ? `/incidentes?${query}` : "/incidentes");
}
