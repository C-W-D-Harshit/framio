import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles } from "lucide-react";

export const meta = {
  name: "Sign in — split layout",
  width: 1440,
  height: 900,
  variationOf: "sign-in",
};

export default function Frame() {
  return (
    <div className="grid min-h-screen grid-cols-2">
      <div data-layer="Brand Story" className="flex flex-col justify-between bg-primary p-12 text-primary-foreground">
        <div className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-5" /> Acme
        </div>
        <blockquote className="max-w-md text-2xl font-medium leading-snug">
          “We shipped our redesign in a weekend. Acme paid for itself in the first month.”
          <footer className="mt-4 text-sm font-normal opacity-70">Priya Raman, founder of Ledgerly</footer>
        </blockquote>
      </div>
      <div data-layer="Sign In" className="flex items-center justify-center p-12">
        <div className="grid w-[360px] gap-6">
          <div data-layer="Welcome" className="grid gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
            <p className="text-sm text-muted-foreground">Sign in to your Acme account</p>
          </div>
          <div data-layer="Sign In Form" className="grid gap-4">
            <div data-layer="Email Field" className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" defaultValue="maya@acme.dev" />
            </div>
            <div data-layer="Password Field" className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" defaultValue="hunter22" />
            </div>
            <Button data-layer="Sign In Button" className="w-full">Sign in</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
