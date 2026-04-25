import { useState } from "react";
import { useAppStore } from "../store/AppStore";
import { SectionCard } from "../components/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MerchantConfig, OfferType } from "../types";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

const ALL_OFFER_TYPES: OfferType[] = ["cashback", "discount", "priority_pickup", "bundle_unlock"];

export function MerchantRulesPage() {
  const { state, updateMerchant } = useAppStore();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState(state.merchants[0].id);
  const merchant = state.merchants.find((m) => m.id === selectedId)!;
  const [draft, setDraft] = useState<MerchantConfig>(merchant);

  const onSelect = (id: string) => {
    setSelectedId(id);
    setDraft(state.merchants.find((m) => m.id === id)!);
  };

  const save = () => {
    updateMerchant(draft);
    toast({ title: "Saved", description: `${draft.name} rules updated.` });
  };

  const toggleOfferType = (t: OfferType) => {
    const has = draft.allowedOfferTypes.includes(t);
    setDraft({
      ...draft,
      allowedOfferTypes: has ? draft.allowedOfferTypes.filter((x) => x !== t) : [...draft.allowedOfferTypes, t],
    });
  };

  return (
    <div className="space-y-6">
      <SectionCard title="Merchant rules (config-first)" layer="merchant" description="Each merchant's behavior is plain configuration — never scattered logic.">
        <div className="flex flex-wrap gap-2">
          {state.merchants.map((m) => (
            <Button
              key={m.id}
              size="sm"
              variant={m.id === selectedId ? "default" : "outline"}
              onClick={() => onSelect(m.id)}
            >
              {m.name}
            </Button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title={draft.name} layer="merchant" description={`${draft.category} · ${draft.distanceMeters}m from user`}>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>Goal</Label>
            <Input value={draft.goals.primary} onChange={(e) => setDraft({ ...draft, goals: { ...draft.goals, primary: e.target.value } })} />
          </div>
          <div className="space-y-2">
            <Label>Max discount %</Label>
            <Input type="number" value={draft.rules.maxDiscountPercent} onChange={(e) => setDraft({ ...draft, rules: { ...draft.rules, maxDiscountPercent: Number(e.target.value) } })} />
          </div>
          <div className="space-y-2">
            <Label>Daily budget (€)</Label>
            <Input type="number" value={draft.rules.dailyBudgetEUR} onChange={(e) => setDraft({ ...draft, rules: { ...draft.rules, dailyBudgetEUR: Number(e.target.value) } })} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Eligible products</Label>
            <div className="flex flex-wrap gap-2">
              {draft.products.map((p) => {
                const eligible = draft.rules.eligibleProductIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        rules: {
                          ...draft.rules,
                          eligibleProductIds: eligible
                            ? draft.rules.eligibleProductIds.filter((x) => x !== p.id)
                            : [...draft.rules.eligibleProductIds, p.id],
                        },
                      })
                    }
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${eligible ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary text-secondary-foreground"}`}
                  >
                    {p.name} · €{p.basePriceEUR.toFixed(2)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <div className="text-sm font-medium">Allows bundles</div>
              <div className="text-xs text-muted-foreground">Allow this merchant to be paired with another.</div>
            </div>
            <Switch
              checked={draft.bundlePermissions.allowsBundles}
              onCheckedChange={(v) => setDraft({ ...draft, bundlePermissions: { ...draft.bundlePermissions, allowsBundles: v } })}
            />
          </div>
          <div className="space-y-2">
            <Label>Brand tone</Label>
            <Input value={draft.brandTone} onChange={(e) => setDraft({ ...draft, brandTone: e.target.value })} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Preferred bundle partner categories</Label>
            <div className="flex flex-wrap gap-1.5">
              {draft.bundlePermissions.preferredPartnerCategories.map((c) => (
                <Badge key={c} variant="secondary">{c}</Badge>
              ))}
            </div>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Allowed offer types</Label>
            <div className="flex flex-wrap gap-2">
              {ALL_OFFER_TYPES.map((t) => {
                const on = draft.allowedOfferTypes.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() => toggleOfferType(t)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? "border-layer-merchant bg-layer-merchant/15 text-layer-merchant" : "border-border bg-secondary text-secondary-foreground"}`}
                  >
                    {t.replace(/_/g, " ")}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["cafe", "bookshop", "florist", "restaurant", "bakery", "museum", "gift_shop"].map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <Button onClick={save}>Save rules</Button>
        </div>
      </SectionCard>
    </div>
  );
}