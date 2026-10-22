import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-20 text-center">
      <p className="font-serif text-5xl">No está en el digesto</p>
      <p className="mt-4 text-muted-foreground">
        No encontramos esa página u ordenanza. Las ordenanzas se buscan por número, por ejemplo{" "}
        <Link href="/ordenanza/4471" className="text-primary underline underline-offset-2">
          /ordenanza/4471
        </Link>
        .
      </p>
      <Link href="/" className="mt-8 inline-block text-sm text-primary hover:underline">
        Volver a preguntar
      </Link>
    </div>
  );
}
