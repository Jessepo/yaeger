"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Download, Trash2, ChevronDown, ChevronUp, Clock, Thermometer, Bean, MapPin, Scale, User } from "lucide-react"
import type { CompletedRoast } from "@/lib/types"

interface RoastHistoryProps {
  completedRoasts: CompletedRoast[]
  onExport: (roast: CompletedRoast) => void
  onDelete: (id: string) => void
}

export function RoastHistory({ completedRoasts, onExport, onDelete }: RoastHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  if (completedRoasts.length === 0) {
    return (
      <div className="rounded-lg bg-card p-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">Roast History</h3>
        <p className="text-sm text-muted-foreground text-center py-4">No completed roasts yet</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-card p-4">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">
        Roast History ({completedRoasts.length})
      </h3>
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {completedRoasts.map((roast) => (
          <div key={roast.id} className="rounded-md bg-secondary/50 overflow-hidden">
            <button
              onClick={() => setExpandedId(expandedId === roast.id ? null : roast.id)}
              className="w-full p-3 flex items-center justify-between hover:bg-secondary transition-colors"
            >
              <div className="text-left">
                <p className="font-medium text-sm">{roast.coffeeInfo?.beanName || roast.profileName}</p>
                <p className="text-xs text-muted-foreground">
                  {roast.coffeeInfo?.origin && <span className="mr-2">{roast.coffeeInfo.origin}</span>}
                  {formatDate(roast.startTime)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right mr-2">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Thermometer className="h-3 w-3" />
                    <span>{Math.round(roast.maxBeanTemperature)}°C</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{formatDuration(roast.totalDuration)}</span>
                  </div>
                </div>
                {expandedId === roast.id ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </button>

            {expandedId === roast.id && (
              <div className="px-3 pb-3 pt-1 border-t border-border">
                {roast.coffeeInfo && (roast.coffeeInfo.beanName || roast.coffeeInfo.origin) && (
                  <div className="mb-3 p-2 rounded bg-background/50">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                      <Bean className="h-3 w-3" />
                      Coffee Details
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      {roast.coffeeInfo.beanName && (
                        <div className="col-span-2">
                          <span className="text-muted-foreground">Bean:</span>
                          <span className="ml-1 font-medium">{roast.coffeeInfo.beanName}</span>
                        </div>
                      )}
                      {roast.coffeeInfo.origin && (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          <span>{roast.coffeeInfo.origin}</span>
                        </div>
                      )}
                      {roast.coffeeInfo.producer && (
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3 text-muted-foreground" />
                          <span>{roast.coffeeInfo.producer}</span>
                        </div>
                      )}
                      {roast.coffeeInfo.variety && (
                        <div>
                          <span className="text-muted-foreground">Variety:</span>
                          <span className="ml-1">{roast.coffeeInfo.variety}</span>
                        </div>
                      )}
                      {roast.coffeeInfo.process && (
                        <div>
                          <span className="text-muted-foreground">Process:</span>
                          <span className="ml-1 capitalize">{roast.coffeeInfo.process}</span>
                        </div>
                      )}
                      {roast.coffeeInfo.weight && (
                        <div className="flex items-center gap-1">
                          <Scale className="h-3 w-3 text-muted-foreground" />
                          <span>{roast.coffeeInfo.weight}g</span>
                        </div>
                      )}
                      {roast.coffeeInfo.roastLevel && (
                        <div>
                          <span className="text-muted-foreground">Roast:</span>
                          <span className="ml-1 capitalize">{roast.coffeeInfo.roastLevel}</span>
                        </div>
                      )}
                      {roast.coffeeInfo.notes && (
                        <div className="col-span-2 mt-1">
                          <span className="text-muted-foreground">Notes:</span>
                          <span className="ml-1 italic">{roast.coffeeInfo.notes}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  <div>
                    <span className="text-muted-foreground">Profile:</span>
                    <span className="ml-1">{roast.profileName}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Target:</span>
                    <span className="ml-1">{roast.targetTemperature}°C</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Target Time:</span>
                    <span className="ml-1">{formatDuration(roast.targetTime)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Data Points:</span>
                    <span className="ml-1">{roast.dataHistory.length}</span>
                  </div>
                </div>
                {roast.notes && <p className="text-xs text-muted-foreground mb-3 italic">"{roast.notes}"</p>}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 bg-transparent" onClick={() => onExport(roast)}>
                    <Download className="h-3 w-3 mr-1" />
                    Export
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDelete(roast.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
