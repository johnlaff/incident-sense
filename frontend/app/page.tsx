import { redirect } from "next/navigation";

import { homeTarget } from "@/lib/home-route";

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  // /?aula=1 (the talk's QR code) opens the lesson start; otherwise the
  // incident queue is the home of the workspace. The query string is kept.
  redirect(homeTarget(await searchParams));
}
