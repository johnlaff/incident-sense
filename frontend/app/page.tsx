import { redirect } from "next/navigation";

export default function Home() {
  // The incident queue is the home of the workspace.
  redirect("/incidentes");
}
