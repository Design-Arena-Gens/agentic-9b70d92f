import dynamic from "next/dynamic";
import Head from "next/head";

const Experience = dynamic(() => import("@/components/fps/FPSScene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-sm uppercase tracking-[0.3em] text-slate-200">
      Preparing Environment
    </div>
  ),
});

export default function Home() {
  return (
    <>
      <Head>
        <title>Aurora Outpost FPS</title>
        <meta
          name="description"
          content="Advanced real-time FPS training scene rendered in the browser with react-three-fiber."
        />
      </Head>
      <div className="h-screen w-screen bg-slate-950 text-white">
        <Experience />
      </div>
    </>
  );
}
