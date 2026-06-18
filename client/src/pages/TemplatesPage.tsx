import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Save } from "lucide-react";
import { useState } from "react";

const CATEGORIES = [
  { value: "hostaway", label: "Hostaway" },
  { value: "airbnb", label: "Airbnb (via Hostaway)" },
  { value: "ezcare", label: "EZCare" },
];

// Pre-defined field keys by category
const FIELD_DEFS: Record<string, Array<{ key: string; label: string; multiline?: boolean }>> = {
  hostaway: [
    { key: "airbnbAccess", label: "Guest Access", multiline: true },
    { key: "airbnbInteraction", label: "Guest Interaction", multiline: true },
    { key: "houseRules", label: "House Rules", multiline: true },
    { key: "specialInstruction", label: "Check-in / Special Instructions", multiline: true },
    { key: "cleaningInstruction", label: "Check-out / Cleaning Instructions", multiline: true },
    { key: "wifiUsername", label: "Wi-Fi Username" },
    { key: "wifiPassword", label: "Wi-Fi Password" },
    { key: "doorSecurityCode", label: "Door Security Code" },
    { key: "keyPickup", label: "Key Pickup Instructions", multiline: true },
    { key: "airbnbNotes", label: "Listing Notes", multiline: true },
  ],
  airbnb: [
    { key: "airbnbAccess", label: "Guest Access", multiline: true },
    { key: "airbnbInteraction", label: "Guest Interaction", multiline: true },
    { key: "airbnbSpace", label: "The Space", multiline: true },
    { key: "airbnbNeighborhoodOverview", label: "Neighborhood Overview", multiline: true },
    { key: "airbnbTransit", label: "Getting Around", multiline: true },
    { key: "airbnbNotes", label: "Other Things to Note", multiline: true },
    { key: "houseRules", label: "House Rules", multiline: true },
  ],
  ezcare: [
    { key: "lockboxGuestUse", label: "Lockbox — Guest Use" },
    { key: "lockboxCompanyOnly", label: "Lockbox — Company Only" },
    { key: "garageCode", label: "Garage Code" },
    { key: "doorCodeGuest", label: "Door Code (Guest)" },
    { key: "doorCodeMaster", label: "Door Code (Master)" },
    { key: "smartLockInstructions", label: "Smart Lock Instructions", multiline: true },
    { key: "trashInstructions", label: "Trash Instructions", multiline: true },
    { key: "garbagePickupDay", label: "Garbage Pickup Day" },
  ],
};

export default function TemplatesPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("hostaway");
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["/api/templates"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/templates");
      return res.json() as Promise<any[]>;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: { name: string; category: string; fieldKey: string; value: string }) => {
      const res = await apiRequest("POST", "/api/templates", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      toast({ title: "Template saved" });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      toast({ title: "Template deleted" });
    },
  });

  function getTemplate(category: string, fieldKey: string) {
    return templates.find((t: any) => t.category === category && t.fieldKey === fieldKey);
  }

  function getValue(category: string, fieldKey: string) {
    const k = `${category}.${fieldKey}`;
    if (editValues[k] !== undefined) return editValues[k];
    return getTemplate(category, fieldKey)?.value ?? "";
  }

  function handleSave(category: string, field: { key: string; label: string }) {
    const k = `${category}.${field.key}`;
    const value = editValues[k] ?? getTemplate(category, field.key)?.value ?? "";
    saveMutation.mutate({ name: field.label, category, fieldKey: field.key, value });
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-display font-800">Templates</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set default values for fields that stay consistent across all listings. These are used when running Bulk Update.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          {CATEGORIES.map(c => (
            <TabsTrigger key={c.value} value={c.value} data-testid={`tab-${c.value}`}>{c.label}</TabsTrigger>
          ))}
        </TabsList>

        {CATEGORIES.map(cat => (
          <TabsContent key={cat.value} value={cat.value} className="mt-6 space-y-4">
            <p className="text-xs text-muted-foreground">
              {cat.value === "airbnb"
                ? "Airbnb fields are pushed through Hostaway's channel manager sync."
                : cat.value === "ezcare"
                ? "EZCare fields are pushed via browser automation to each property record."
                : "These fields will be applied to all selected Hostaway listings during Bulk Update."}
            </p>

            {FIELD_DEFS[cat.value].map(field => {
              const editKey = `${cat.value}.${field.key}`;
              const value = getValue(cat.value, field.key);
              const saved = getTemplate(cat.value, field.key);
              const isDirty = editValues[editKey] !== undefined && editValues[editKey] !== (saved?.value ?? "");

              return (
                <Card key={field.key} className="border-border">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <Label className="text-sm font-medium">{field.label}</Label>
                        {field.multiline ? (
                          <Textarea
                            rows={3}
                            value={value}
                            onChange={e => setEditValues(prev => ({ ...prev, [editKey]: e.target.value }))}
                            placeholder={`Default ${field.label.toLowerCase()} text...`}
                            className="text-sm resize-none"
                            data-testid={`textarea-${field.key}`}
                          />
                        ) : (
                          <Input
                            value={value}
                            onChange={e => setEditValues(prev => ({ ...prev, [editKey]: e.target.value }))}
                            placeholder={`Default ${field.label.toLowerCase()}...`}
                            className="text-sm"
                            data-testid={`input-${field.key}`}
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-2 pt-6">
                        <Button
                          size="sm"
                          variant={isDirty ? "default" : "outline"}
                          onClick={() => handleSave(cat.value, field)}
                          disabled={saveMutation.isPending}
                          data-testid={`button-save-${field.key}`}
                        >
                          <Save size={13} className="mr-1" />
                          {saved ? "Update" : "Save"}
                        </Button>
                        {saved && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteMutation.mutate(saved.id)}
                            className="text-destructive hover:text-destructive"
                            data-testid={`button-delete-${field.key}`}
                          >
                            <Trash2 size={13} />
                          </Button>
                        )}
                      </div>
                    </div>
                    {saved && (
                      <div className="mt-1">
                        <span className="text-xs text-muted-foreground">Saved</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
