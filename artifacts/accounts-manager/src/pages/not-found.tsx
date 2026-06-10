import { Link } from "wouter";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { strings } from "@/lib/strings";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <div className="text-center space-y-4 max-w-sm">
        <SearchX className="h-16 w-16 text-muted-foreground opacity-40 mx-auto" />
        <h1 className="text-3xl font-bold">404</h1>
        <p className="text-muted-foreground">{strings.notFound.message}</p>
        <Button asChild>
          <Link href="/">{strings.notFound.goHome}</Link>
        </Button>
      </div>
    </div>
  );
}
