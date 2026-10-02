import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles } from "lucide-react";

export const meta = {
  name: "Sign in",
  width: 1440,
  height: 900,
};

export default function Frame() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <Card data-layer="Sign In Card" className="w-[400px]">
        <CardHeader data-layer="Welcome" className="text-center">
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </div>
          <CardTitle className="text-xl">Welcome back</CardTitle>
          <CardDescription>Sign in to your Acme account</CardDescription>
        </CardHeader>
        <CardContent data-layer="Sign In Form" className="grid gap-4">
          <div data-layer="Email Field" className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" defaultValue="maya@acme.dev" />
          </div>
          <div data-layer="Password Field" className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" defaultValue="hunter22" />
          </div>
          <Button data-layer="Sign In Button" className="w-full">Sign in</Button>
          <p className="text-center text-sm text-muted-foreground">
            No account? <span className="font-medium text-foreground underline underline-offset-4">Create one</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
