"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Save, Download, Upload, Trash2 } from "lucide-react"
import type { RoastProfile } from "@/lib/types"
import { v4 as uuidv4} from 'uuid'

interface ProfilePanelProps {
  currentProfile: RoastProfile | null
  onSaveProfile: (name: string) => void
  onLoadProfile: (profile: RoastProfile) => void
}

export function ProfilePanel({ currentProfile, onSaveProfile, onLoadProfile }: ProfilePanelProps) {
  const [profileName, setProfileName] = useState(currentProfile?.name ?? "New Profile")
  const [savedProfiles, setSavedProfiles] = useState<RoastProfile[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("roast-profiles")
      return saved ? JSON.parse(saved) : []
    }
    return []
  })

  const handleSave = () => {
    if (!currentProfile) return

    const profileToSave = { ...currentProfile, name: profileName }
    const existingIndex = savedProfiles.findIndex((p) => p.id === profileToSave.id)

    let newProfiles: RoastProfile[]
    if (existingIndex >= 0) {
      newProfiles = [...savedProfiles]
      newProfiles[existingIndex] = profileToSave
    } else {
      newProfiles = [...savedProfiles, profileToSave]
    }

    setSavedProfiles(newProfiles)
    localStorage.setItem("roast-profiles", JSON.stringify(newProfiles))
  }

  const handleDelete = (id: string) => {
    const newProfiles = savedProfiles.filter((p) => p.id !== id)
    setSavedProfiles(newProfiles)
    localStorage.setItem("roast-profiles", JSON.stringify(newProfiles))
  }

  const handleExport = () => {
    if (!currentProfile) return
    const dataStr = JSON.stringify(currentProfile, null, 2)
    const blob = new Blob([dataStr], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${profileName.replace(/\s+/g, "-").toLowerCase()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const profile = JSON.parse(event.target?.result as string) as RoastProfile
        profile.id = uuidv4()
        profile.createdAt = Date.now()
        onLoadProfile(profile)
        setProfileName(profile.name)
      } catch (err) {
        console.error("Failed to parse profile:", err)
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-card p-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">Current Profile</h3>
        <div className="space-y-3">
          <div>
            <Label htmlFor="profile-name" className="text-xs text-muted-foreground">
              Profile Name
            </Label>
            <Input
              id="profile-name"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} className="flex-1" variant="secondary">
              <Save className="mr-2 h-4 w-4" />
              Save
            </Button>
            <Button onClick={handleExport} variant="outline" size="icon">
              <Download className="h-4 w-4" />
            </Button>
            <label>
              <input type="file" accept=".json" onChange={handleImport} className="hidden" />
              <Button variant="outline" size="icon" asChild>
                <span>
                  <Upload className="h-4 w-4" />
                </span>
              </Button>
            </label>
          </div>
        </div>
      </div>

      {savedProfiles.length > 0 && (
        <div className="rounded-lg bg-card p-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">Saved Profiles</h3>
          <div className="space-y-2">
            {savedProfiles.map((profile) => (
              <div
                key={profile.id}
                className="flex items-center justify-between p-3 rounded-md bg-secondary/50 hover:bg-secondary transition-colors"
              >
                <button
                  onClick={() => {
                    onLoadProfile(profile)
                    setProfileName(profile.name)
                  }}
                  className="flex-1 text-left"
                >
                  <p className="font-medium text-sm">{profile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {profile.targetTemperature}°C in {Math.round(profile.targetTime / 60)}min
                  </p>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(profile.id)}
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
