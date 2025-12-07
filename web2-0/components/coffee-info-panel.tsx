"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Bean } from "lucide-react"
import type { CoffeeInfo } from "@/lib/types"

interface CoffeeInfoPanelProps {
  coffeeInfo: CoffeeInfo
  onChange: (info: CoffeeInfo) => void
  disabled?: boolean
}

export function CoffeeInfoPanel({ coffeeInfo, onChange, disabled }: CoffeeInfoPanelProps) {
  const updateField = <K extends keyof CoffeeInfo>(field: K, value: CoffeeInfo[K]) => {
    onChange({ ...coffeeInfo, [field]: value })
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <Bean className="h-4 w-4" />
          Coffee Information
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="beanName" className="text-xs text-muted-foreground">
              Bean Name *
            </Label>
            <Input
              id="beanName"
              value={coffeeInfo.beanName}
              onChange={(e) => updateField("beanName", e.target.value)}
              placeholder="e.g., Ethiopia Yirgacheffe"
              className="h-9 bg-secondary/50"
              disabled={disabled}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="origin" className="text-xs text-muted-foreground">
              Origin *
            </Label>
            <Input
              id="origin"
              value={coffeeInfo.origin}
              onChange={(e) => updateField("origin", e.target.value)}
              placeholder="e.g., Ethiopia"
              className="h-9 bg-secondary/50"
              disabled={disabled}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="producer" className="text-xs text-muted-foreground">
              Producer
            </Label>
            <Input
              id="producer"
              value={coffeeInfo.producer || ""}
              onChange={(e) => updateField("producer", e.target.value)}
              placeholder="e.g., Finca La Esperanza"
              className="h-9 bg-secondary/50"
              disabled={disabled}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="variety" className="text-xs text-muted-foreground">
              Variety
            </Label>
            <Input
              id="variety"
              value={coffeeInfo.variety || ""}
              onChange={(e) => updateField("variety", e.target.value)}
              placeholder="e.g., Heirloom"
              className="h-9 bg-secondary/50"
              disabled={disabled}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="process" className="text-xs text-muted-foreground">
              Process
            </Label>
            <Select
              value={coffeeInfo.process || ""}
              onValueChange={(value) => updateField("process", value)}
              disabled={disabled}
            >
              <SelectTrigger id="process" className="h-9 bg-secondary/50">
                <SelectValue placeholder="Select process" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="washed">Washed</SelectItem>
                <SelectItem value="natural">Natural</SelectItem>
                <SelectItem value="honey">Honey</SelectItem>
                <SelectItem value="anaerobic">Anaerobic</SelectItem>
                <SelectItem value="wet-hulled">Wet Hulled</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="weight" className="text-xs text-muted-foreground">
              Weight (g)
            </Label>
            <Input
              id="weight"
              type="number"
              value={coffeeInfo.weight || ""}
              onChange={(e) => updateField("weight", e.target.value ? Number(e.target.value) : undefined)}
              placeholder="e.g., 500"
              className="h-9 bg-secondary/50"
              disabled={disabled}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="roastLevel" className="text-xs text-muted-foreground">
              Target Roast Level
            </Label>
            <Select
              value={coffeeInfo.roastLevel || ""}
              onValueChange={(value) => updateField("roastLevel", value)}
              disabled={disabled}
            >
              <SelectTrigger id="roastLevel" className="h-9 bg-secondary/50">
                <SelectValue placeholder="Select roast level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="light-medium">Light-Medium</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="medium-dark">Medium-Dark</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-xs text-muted-foreground">
              Notes
            </Label>
            <Input
              id="notes"
              value={coffeeInfo.notes || ""}
              onChange={(e) => updateField("notes", e.target.value)}
              placeholder="Tasting notes, batch info..."
              className="h-9 bg-secondary/50"
              disabled={disabled}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
