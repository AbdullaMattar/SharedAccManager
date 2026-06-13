import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { strings } from "@/lib/strings";

export default function About() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">{strings.about.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">{strings.about.description}</p>
          <a
            href={strings.about.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block font-medium text-primary underline underline-offset-4"
          >
            {strings.about.poweredBy}
          </a>
          <div>
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">{strings.about.back}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
