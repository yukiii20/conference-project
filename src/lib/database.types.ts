export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      announcements: {
        Row: {
          audience: Database["public"]["Enums"]["audience"][]
          body: string
          conference_id: string
          created_at: string
          created_by: string | null
          id: string
          publish_at: string | null
          send_email: boolean
          status: Database["public"]["Enums"]["announcement_status"]
          title: string
          updated_at: string
        }
        Insert: {
          audience?: Database["public"]["Enums"]["audience"][]
          body: string
          conference_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          publish_at?: string | null
          send_email?: boolean
          status?: Database["public"]["Enums"]["announcement_status"]
          title: string
          updated_at?: string
        }
        Update: {
          audience?: Database["public"]["Enums"]["audience"][]
          body?: string
          conference_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          publish_at?: string | null
          send_email?: boolean
          status?: Database["public"]["Enums"]["announcement_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          conference_id: string | null
          entity_id: string | null
          entity_type: string
          id: number
          ip: unknown
          new_values: Json | null
          occurred_at: string
          old_values: Json | null
          request_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          conference_id?: string | null
          entity_id?: string | null
          entity_type: string
          id?: never
          ip?: unknown
          new_values?: Json | null
          occurred_at?: string
          old_values?: Json | null
          request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          conference_id?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: never
          ip?: unknown
          new_values?: Json | null
          occurred_at?: string
          old_values?: Json | null
          request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      certificate_templates: {
        Row: {
          background_path: string | null
          certificate_type: Database["public"]["Enums"]["certificate_type"]
          conference_id: string
          created_at: string
          id: string
          is_active: boolean
          layout: Json
          name: string
          signatories: Json
          updated_at: string
        }
        Insert: {
          background_path?: string | null
          certificate_type: Database["public"]["Enums"]["certificate_type"]
          conference_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          layout?: Json
          name: string
          signatories?: Json
          updated_at?: string
        }
        Update: {
          background_path?: string | null
          certificate_type?: Database["public"]["Enums"]["certificate_type"]
          conference_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          layout?: Json
          name?: string
          signatories?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "certificate_templates_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      certificates: {
        Row: {
          certificate_number: string
          certificate_type: Database["public"]["Enums"]["certificate_type"]
          conference_id: string
          created_at: string
          file_path: string | null
          id: string
          issued_at: string
          issued_by: string | null
          recipient_name: string
          recipient_user_id: string
          revoked_at: string | null
          revoked_reason: string | null
          session_id: string | null
          status: Database["public"]["Enums"]["certificate_status"]
          submission_id: string | null
          template_id: string | null
          updated_at: string
          verification_token: string
        }
        Insert: {
          certificate_number: string
          certificate_type: Database["public"]["Enums"]["certificate_type"]
          conference_id: string
          created_at?: string
          file_path?: string | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          recipient_name: string
          recipient_user_id: string
          revoked_at?: string | null
          revoked_reason?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["certificate_status"]
          submission_id?: string | null
          template_id?: string | null
          updated_at?: string
          verification_token?: string
        }
        Update: {
          certificate_number?: string
          certificate_type?: Database["public"]["Enums"]["certificate_type"]
          conference_id?: string
          created_at?: string
          file_path?: string | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          recipient_name?: string
          recipient_user_id?: string
          revoked_at?: string | null
          revoked_reason?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["certificate_status"]
          submission_id?: string | null
          template_id?: string | null
          updated_at?: string
          verification_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "certificates_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_session_fk"
            columns: ["session_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "conference_sessions"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "certificates_session_fk"
            columns: ["session_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "v_session_attendance_counts"
            referencedColumns: ["session_id", "conference_id"]
          },
          {
            foreignKeyName: "certificates_submission_fk"
            columns: ["submission_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "certificates_template_fk"
            columns: ["template_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "certificate_templates"
            referencedColumns: ["id", "conference_id"]
          },
        ]
      }
      committee_members: {
        Row: {
          affiliation: string | null
          committee_id: string
          country: string | null
          created_at: string
          display_name: string | null
          display_order: number
          id: string
          member_role: Database["public"]["Enums"]["committee_member_role"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          affiliation?: string | null
          committee_id: string
          country?: string | null
          created_at?: string
          display_name?: string | null
          display_order?: number
          id?: string
          member_role?: Database["public"]["Enums"]["committee_member_role"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          affiliation?: string | null
          committee_id?: string
          country?: string | null
          created_at?: string
          display_name?: string | null
          display_order?: number
          id?: string
          member_role?: Database["public"]["Enums"]["committee_member_role"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "committee_members_committee_id_fkey"
            columns: ["committee_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "committee_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      committees: {
        Row: {
          committee_type: Database["public"]["Enums"]["committee_type"]
          conference_id: string
          created_at: string
          description: string | null
          display_order: number
          id: string
          is_public: boolean
          name: string
          updated_at: string
        }
        Insert: {
          committee_type?: Database["public"]["Enums"]["committee_type"]
          conference_id: string
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_public?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          committee_type?: Database["public"]["Enums"]["committee_type"]
          conference_id?: string
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_public?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "committees_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_attendance: {
        Row: {
          attendance_date: string
          checked_in_at: string
          checked_in_by: string | null
          checked_out_at: string | null
          conference_id: string
          created_at: string
          id: string
          method: Database["public"]["Enums"]["checkin_method"]
          registration_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attendance_date: string
          checked_in_at?: string
          checked_in_by?: string | null
          checked_out_at?: string | null
          conference_id: string
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["checkin_method"]
          registration_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attendance_date?: string
          checked_in_at?: string
          checked_in_by?: string | null
          checked_out_at?: string | null
          conference_id?: string
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["checkin_method"]
          registration_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_attendance_checked_in_by_fkey"
            columns: ["checked_in_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_attendance_registration_fk"
            columns: ["registration_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "conference_attendance_registration_fk"
            columns: ["registration_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "v_registration_payment_status"
            referencedColumns: ["registration_id", "conference_id"]
          },
          {
            foreignKeyName: "conference_attendance_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_counters: {
        Row: {
          conference_id: string
          counter_key: string
          last_value: number
        }
        Insert: {
          conference_id: string
          counter_key: string
          last_value?: number
        }
        Update: {
          conference_id?: string
          counter_key?: string
          last_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "conference_counters_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_deadlines: {
        Row: {
          closes_at: string | null
          conference_id: string
          created_at: string
          deadline_type: string
          grace_minutes: number
          id: string
          is_public: boolean
          notes: string | null
          opens_at: string
          updated_at: string
        }
        Insert: {
          closes_at?: string | null
          conference_id: string
          created_at?: string
          deadline_type: string
          grace_minutes?: number
          id?: string
          is_public?: boolean
          notes?: string | null
          opens_at: string
          updated_at?: string
        }
        Update: {
          closes_at?: string | null
          conference_id?: string
          created_at?: string
          deadline_type?: string
          grace_minutes?: number
          id?: string
          is_public?: boolean
          notes?: string | null
          opens_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_deadlines_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_deadlines_deadline_type_fkey"
            columns: ["deadline_type"]
            isOneToOne: false
            referencedRelation: "deadline_types"
            referencedColumns: ["code"]
          },
        ]
      }
      conference_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          conference_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role_code: string
          status: Database["public"]["Enums"]["invitation_status"]
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          conference_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role_code: string
          status?: Database["public"]["Enums"]["invitation_status"]
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          conference_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role_code?: string
          status?: Database["public"]["Enums"]["invitation_status"]
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_invitations_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_invitations_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
        ]
      }
      conference_members: {
        Row: {
          added_by: string | null
          conference_id: string
          created_at: string
          id: string
          is_public: boolean
          max_review_load: number | null
          role_code: string
          status: Database["public"]["Enums"]["member_status"]
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          added_by?: string | null
          conference_id: string
          created_at?: string
          id?: string
          is_public?: boolean
          max_review_load?: number | null
          role_code: string
          status?: Database["public"]["Enums"]["member_status"]
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          added_by?: string | null
          conference_id?: string
          created_at?: string
          id?: string
          is_public?: boolean
          max_review_load?: number | null
          role_code?: string
          status?: Database["public"]["Enums"]["member_status"]
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_members_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_members_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "conference_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_sessions: {
        Row: {
          conference_id: string
          created_at: string
          description: string | null
          ends_at: string
          id: string
          room_id: string
          session_type: Database["public"]["Enums"]["session_type"]
          slot_id: string | null
          starts_at: string
          status: Database["public"]["Enums"]["session_status"]
          time_range: unknown
          title: string
          track_id: string | null
          updated_at: string
        }
        Insert: {
          conference_id: string
          created_at?: string
          description?: string | null
          ends_at: string
          id?: string
          room_id: string
          session_type?: Database["public"]["Enums"]["session_type"]
          slot_id?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["session_status"]
          time_range?: unknown
          title: string
          track_id?: string | null
          updated_at?: string
        }
        Update: {
          conference_id?: string
          created_at?: string
          description?: string | null
          ends_at?: string
          id?: string
          room_id?: string
          session_type?: Database["public"]["Enums"]["session_type"]
          slot_id?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["session_status"]
          time_range?: unknown
          title?: string
          track_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_sessions_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_sessions_room_fk"
            columns: ["room_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "conference_sessions_room_fk"
            columns: ["room_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "v_room_utilization"
            referencedColumns: ["room_id", "conference_id"]
          },
          {
            foreignKeyName: "conference_sessions_slot_fk"
            columns: ["slot_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "schedule_slots"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "conference_sessions_track_fk"
            columns: ["track_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "conference_tracks"
            referencedColumns: ["id", "conference_id"]
          },
        ]
      }
      conference_settings: {
        Row: {
          allowed_file_types: string[]
          authors_see_review_comments: boolean
          certificate_min_sessions: number | null
          conference_id: string
          created_at: string
          default_currency: string
          extra: Json
          max_abstract_words: number
          max_file_size_mb: number
          max_submissions_per_author: number | null
          registration_capacity: number | null
          registration_requires_payment: boolean
          review_mode: Database["public"]["Enums"]["review_mode"]
          reviews_required: number
          session_attendance_enabled: boolean
          updated_at: string
        }
        Insert: {
          allowed_file_types?: string[]
          authors_see_review_comments?: boolean
          certificate_min_sessions?: number | null
          conference_id: string
          created_at?: string
          default_currency?: string
          extra?: Json
          max_abstract_words?: number
          max_file_size_mb?: number
          max_submissions_per_author?: number | null
          registration_capacity?: number | null
          registration_requires_payment?: boolean
          review_mode?: Database["public"]["Enums"]["review_mode"]
          reviews_required?: number
          session_attendance_enabled?: boolean
          updated_at?: string
        }
        Update: {
          allowed_file_types?: string[]
          authors_see_review_comments?: boolean
          certificate_min_sessions?: number | null
          conference_id?: string
          created_at?: string
          default_currency?: string
          extra?: Json
          max_abstract_words?: number
          max_file_size_mb?: number
          max_submissions_per_author?: number | null
          registration_capacity?: number | null
          registration_requires_payment?: boolean
          review_mode?: Database["public"]["Enums"]["review_mode"]
          reviews_required?: number
          session_attendance_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_settings_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: true
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_speakers: {
        Row: {
          affiliation: string | null
          bio: string | null
          conference_id: string
          created_at: string
          designation: string | null
          display_order: number
          full_name: string
          id: string
          is_public: boolean
          photo_path: string | null
          speaker_type: Database["public"]["Enums"]["speaker_type"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          affiliation?: string | null
          bio?: string | null
          conference_id: string
          created_at?: string
          designation?: string | null
          display_order?: number
          full_name: string
          id?: string
          is_public?: boolean
          photo_path?: string | null
          speaker_type?: Database["public"]["Enums"]["speaker_type"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          affiliation?: string | null
          bio?: string | null
          conference_id?: string
          created_at?: string
          designation?: string | null
          display_order?: number
          full_name?: string
          id?: string
          is_public?: boolean
          photo_path?: string | null
          speaker_type?: Database["public"]["Enums"]["speaker_type"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conference_speakers_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_speakers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_supporters: {
        Row: {
          conference_id: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          logo_path: string | null
          name: string
          tier: string
          updated_at: string
          website_url: string | null
        }
        Insert: {
          conference_id: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          logo_path?: string | null
          name: string
          tier?: string
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          conference_id?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          logo_path?: string | null
          name?: string
          tier?: string
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conference_supporters_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_tracks: {
        Row: {
          code: string | null
          conference_id: string
          created_at: string
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          conference_id: string
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          conference_id?: string
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_tracks_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      conferences: {
        Row: {
          address: string | null
          banner_path: string | null
          city: string | null
          code: string
          contact_email: string | null
          contact_phone: string | null
          country: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          end_date: string
          id: string
          location_map_url: string | null
          logo_path: string | null
          name: string
          primary_color: string | null
          published_at: string | null
          short_name: string | null
          slug: string
          social_links: Json
          start_date: string
          status: Database["public"]["Enums"]["conference_status"]
          submission_guidelines: string | null
          tagline: string | null
          theme: string | null
          timezone: string
          updated_at: string
          venue_name: string | null
          website_url: string | null
          welcome_text: string | null
        }
        Insert: {
          address?: string | null
          banner_path?: string | null
          city?: string | null
          code: string
          contact_email?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          end_date: string
          id?: string
          location_map_url?: string | null
          logo_path?: string | null
          name: string
          primary_color?: string | null
          published_at?: string | null
          short_name?: string | null
          slug: string
          social_links?: Json
          start_date: string
          status?: Database["public"]["Enums"]["conference_status"]
          submission_guidelines?: string | null
          tagline?: string | null
          theme?: string | null
          timezone?: string
          updated_at?: string
          venue_name?: string | null
          website_url?: string | null
          welcome_text?: string | null
        }
        Update: {
          address?: string | null
          banner_path?: string | null
          city?: string | null
          code?: string
          contact_email?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          end_date?: string
          id?: string
          location_map_url?: string | null
          logo_path?: string | null
          name?: string
          primary_color?: string | null
          published_at?: string | null
          short_name?: string | null
          slug?: string
          social_links?: Json
          start_date?: string
          status?: Database["public"]["Enums"]["conference_status"]
          submission_guidelines?: string | null
          tagline?: string | null
          theme?: string | null
          timezone?: string
          updated_at?: string
          venue_name?: string | null
          website_url?: string | null
          welcome_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conferences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conflicts_of_interest: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          reason: string | null
          source: Database["public"]["Enums"]["coi_source"]
          submission_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          source: Database["public"]["Enums"]["coi_source"]
          submission_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          source?: Database["public"]["Enums"]["coi_source"]
          submission_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conflicts_of_interest_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conflicts_of_interest_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conflicts_of_interest_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deadline_extensions: {
        Row: {
          conference_deadline_id: string
          created_at: string
          granted_by: string | null
          id: string
          new_closes_at: string
          reason: string | null
          submission_id: string | null
          user_id: string | null
        }
        Insert: {
          conference_deadline_id: string
          created_at?: string
          granted_by?: string | null
          id?: string
          new_closes_at: string
          reason?: string | null
          submission_id?: string | null
          user_id?: string | null
        }
        Update: {
          conference_deadline_id?: string
          created_at?: string
          granted_by?: string | null
          id?: string
          new_closes_at?: string
          reason?: string | null
          submission_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deadline_extensions_conference_deadline_id_fkey"
            columns: ["conference_deadline_id"]
            isOneToOne: false
            referencedRelation: "conference_deadlines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deadline_extensions_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deadline_extensions_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deadline_extensions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deadline_types: {
        Row: {
          code: string
          created_at: string
          is_window: boolean
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          is_window?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          is_window?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      email_logs: {
        Row: {
          attempts: number
          conference_id: string | null
          entity_id: string | null
          entity_type: string | null
          error_message: string | null
          id: number
          provider: string | null
          provider_message_id: string | null
          queued_at: string
          recipient_email: string
          sent_at: string | null
          status: Database["public"]["Enums"]["email_status"]
          subject: string
          template_data: Json
          template_key: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          conference_id?: string | null
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          id?: never
          provider?: string | null
          provider_message_id?: string | null
          queued_at?: string
          recipient_email: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_status"]
          subject: string
          template_data?: Json
          template_key: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          conference_id?: string | null
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          id?: never
          provider?: string | null
          provider_message_id?: string | null
          queued_at?: string
          recipient_email?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_status"]
          subject?: string
          template_data?: Json
          template_key?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_logs_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body_html: string
          conference_id: string | null
          created_at: string
          id: string
          is_active: boolean
          subject: string
          template_key: string
          updated_at: string
        }
        Insert: {
          body_html: string
          conference_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          subject: string
          template_key: string
          updated_at?: string
        }
        Update: {
          body_html?: string
          conference_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          subject?: string
          template_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          conference_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          link_path: string | null
          read_at: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          body?: string | null
          conference_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link_path?: string | null
          read_at?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          body?: string | null
          conference_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link_path?: string | null
          read_at?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_webhook_events: {
        Row: {
          id: number
          payload: Json
          payment_id: string | null
          processed_at: string | null
          processing_error: string | null
          provider: string
          provider_event_id: string
          received_at: string
          signature_valid: boolean
        }
        Insert: {
          id?: never
          payload: Json
          payment_id?: string | null
          processed_at?: string | null
          processing_error?: string | null
          provider: string
          provider_event_id: string
          received_at?: string
          signature_valid: boolean
        }
        Update: {
          id?: never
          payload?: Json
          payment_id?: string | null
          processed_at?: string | null
          processing_error?: string | null
          provider?: string
          provider_event_id?: string
          received_at?: string
          signature_valid?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "payment_webhook_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          conference_id: string
          created_at: string
          currency: string
          failure_reason: string | null
          id: string
          idempotency_key: string
          method: Database["public"]["Enums"]["payment_method"]
          paid_at: string | null
          provider: string
          provider_reference: string | null
          provider_transaction_id: string | null
          recorded_by: string | null
          refunded_amount: number
          registration_id: string
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          amount: number
          conference_id: string
          created_at?: string
          currency: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          method: Database["public"]["Enums"]["payment_method"]
          paid_at?: string | null
          provider?: string
          provider_reference?: string | null
          provider_transaction_id?: string | null
          recorded_by?: string | null
          refunded_amount?: number
          registration_id: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          amount?: number
          conference_id?: string
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          method?: Database["public"]["Enums"]["payment_method"]
          paid_at?: string | null
          provider?: string
          provider_reference?: string | null
          provider_transaction_id?: string | null
          recorded_by?: string | null
          refunded_amount?: number
          registration_id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_registration_fk"
            columns: ["registration_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "payments_registration_fk"
            columns: ["registration_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "v_registration_payment_status"
            referencedColumns: ["registration_id", "conference_id"]
          },
        ]
      }
      permissions: {
        Row: {
          code: string
          created_at: string
          description: string | null
          module: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          module: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          module?: string
        }
        Relationships: []
      }
      platform_user_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          role_code: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          role_code: string
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          role_code?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_user_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_user_roles_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "platform_user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      presentations: {
        Row: {
          conference_id: string
          created_at: string
          ends_at: string
          id: string
          marked_at: string | null
          marked_by: string | null
          notes: string | null
          presentation_order: number
          presenter_user_id: string | null
          room_id: string
          session_id: string
          speaker_id: string | null
          starts_at: string
          status: Database["public"]["Enums"]["presentation_status"]
          submission_id: string | null
          time_range: unknown
          title: string | null
          updated_at: string
        }
        Insert: {
          conference_id: string
          created_at?: string
          ends_at: string
          id?: string
          marked_at?: string | null
          marked_by?: string | null
          notes?: string | null
          presentation_order: number
          presenter_user_id?: string | null
          room_id: string
          session_id: string
          speaker_id?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["presentation_status"]
          submission_id?: string | null
          time_range?: unknown
          title?: string | null
          updated_at?: string
        }
        Update: {
          conference_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          marked_at?: string | null
          marked_by?: string | null
          notes?: string | null
          presentation_order?: number
          presenter_user_id?: string | null
          room_id?: string
          session_id?: string
          speaker_id?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["presentation_status"]
          submission_id?: string | null
          time_range?: unknown
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "presentations_marked_by_fkey"
            columns: ["marked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presentations_presenter_user_id_fkey"
            columns: ["presenter_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presentations_room_fk"
            columns: ["room_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "presentations_room_fk"
            columns: ["room_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "v_room_utilization"
            referencedColumns: ["room_id", "conference_id"]
          },
          {
            foreignKeyName: "presentations_session_fk"
            columns: ["session_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "conference_sessions"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "presentations_session_fk"
            columns: ["session_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "v_session_attendance_counts"
            referencedColumns: ["session_id", "conference_id"]
          },
          {
            foreignKeyName: "presentations_speaker_fk"
            columns: ["speaker_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "conference_speakers"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "presentations_submission_fk"
            columns: ["submission_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id", "conference_id"]
          },
        ]
      }
      profiles: {
        Row: {
          bio: string | null
          country: string | null
          created_at: string
          department: string | null
          email: string
          full_name: string
          id: string
          institution: string | null
          orcid: string | null
          phone: string | null
          photo_path: string | null
          position: string | null
          status: Database["public"]["Enums"]["user_status"]
          updated_at: string
        }
        Insert: {
          bio?: string | null
          country?: string | null
          created_at?: string
          department?: string | null
          email: string
          full_name: string
          id: string
          institution?: string | null
          orcid?: string | null
          phone?: string | null
          photo_path?: string | null
          position?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Update: {
          bio?: string | null
          country?: string | null
          created_at?: string
          department?: string | null
          email?: string
          full_name?: string
          id?: string
          institution?: string | null
          orcid?: string | null
          phone?: string | null
          photo_path?: string | null
          position?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Relationships: []
      }
      registration_categories: {
        Row: {
          code: string
          conference_id: string
          created_at: string
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          name: string
          requires_proof: boolean
          updated_at: string
        }
        Insert: {
          code: string
          conference_id: string
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          requires_proof?: boolean
          updated_at?: string
        }
        Update: {
          code?: string
          conference_id?: string
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          requires_proof?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "registration_categories_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      registration_fees: {
        Row: {
          amount: number
          category_id: string
          created_at: string
          currency: string
          fee_type: Database["public"]["Enums"]["fee_type"]
          id: string
          is_active: boolean
          updated_at: string
          valid_from: string
          valid_until: string
        }
        Insert: {
          amount: number
          category_id: string
          created_at?: string
          currency: string
          fee_type?: Database["public"]["Enums"]["fee_type"]
          id?: string
          is_active?: boolean
          updated_at?: string
          valid_from: string
          valid_until: string
        }
        Update: {
          amount?: number
          category_id?: string
          created_at?: string
          currency?: string
          fee_type?: Database["public"]["Enums"]["fee_type"]
          id?: string
          is_active?: boolean
          updated_at?: string
          valid_from?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "registration_fees_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "registration_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      registrations: {
        Row: {
          amount_due: number
          cancelled_at: string | null
          category_id: string
          conference_id: string
          confirmed_at: string | null
          created_at: string
          currency: string
          fee_id: string | null
          id: string
          proof_path: string | null
          qr_token: string
          registered_at: string
          registration_number: string
          status: Database["public"]["Enums"]["registration_status"]
          updated_at: string
          user_id: string
          waived_by: string | null
          waiver_reason: string | null
        }
        Insert: {
          amount_due: number
          cancelled_at?: string | null
          category_id: string
          conference_id: string
          confirmed_at?: string | null
          created_at?: string
          currency: string
          fee_id?: string | null
          id?: string
          proof_path?: string | null
          qr_token?: string
          registered_at?: string
          registration_number: string
          status?: Database["public"]["Enums"]["registration_status"]
          updated_at?: string
          user_id: string
          waived_by?: string | null
          waiver_reason?: string | null
        }
        Update: {
          amount_due?: number
          cancelled_at?: string | null
          category_id?: string
          conference_id?: string
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          fee_id?: string | null
          id?: string
          proof_path?: string | null
          qr_token?: string
          registered_at?: string
          registration_number?: string
          status?: Database["public"]["Enums"]["registration_status"]
          updated_at?: string
          user_id?: string
          waived_by?: string | null
          waiver_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registrations_category_fk"
            columns: ["category_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "registration_categories"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "registrations_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_fee_id_fkey"
            columns: ["fee_id"]
            isOneToOne: false
            referencedRelation: "registration_fees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_waived_by_fkey"
            columns: ["waived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      review_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          cancel_reason: string | null
          completed_at: string | null
          conference_id: string
          created_at: string
          due_at: string
          id: string
          responded_at: string | null
          reviewer_id: string
          round: number
          status: Database["public"]["Enums"]["assignment_status"]
          submission_id: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          cancel_reason?: string | null
          completed_at?: string | null
          conference_id: string
          created_at?: string
          due_at: string
          id?: string
          responded_at?: string | null
          reviewer_id: string
          round: number
          status?: Database["public"]["Enums"]["assignment_status"]
          submission_id: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          cancel_reason?: string | null
          completed_at?: string | null
          conference_id?: string
          created_at?: string
          due_at?: string
          id?: string
          responded_at?: string | null
          reviewer_id?: string
          round?: number
          status?: Database["public"]["Enums"]["assignment_status"]
          submission_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_assignments_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_assignments_submission_fk"
            columns: ["submission_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id", "conference_id"]
          },
        ]
      }
      reviewer_tracks: {
        Row: {
          conference_id: string
          created_at: string
          track_id: string
          user_id: string
        }
        Insert: {
          conference_id: string
          created_at?: string
          track_id: string
          user_id: string
        }
        Update: {
          conference_id?: string
          created_at?: string
          track_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviewer_tracks_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviewer_tracks_track_fk"
            columns: ["track_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "conference_tracks"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "reviewer_tracks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          assignment_id: string
          comments_to_author: string | null
          confidence: number | null
          confidential_comments: string | null
          created_at: string
          id: string
          methodology: number | null
          originality: number | null
          overall_score: number | null
          quality: number | null
          recommendation: Database["public"]["Enums"]["recommendation"] | null
          relevance: number | null
          status: Database["public"]["Enums"]["review_status"]
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          assignment_id: string
          comments_to_author?: string | null
          confidence?: number | null
          confidential_comments?: string | null
          created_at?: string
          id?: string
          methodology?: number | null
          originality?: number | null
          overall_score?: number | null
          quality?: number | null
          recommendation?: Database["public"]["Enums"]["recommendation"] | null
          relevance?: number | null
          status?: Database["public"]["Enums"]["review_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          assignment_id?: string
          comments_to_author?: string | null
          confidence?: number | null
          confidential_comments?: string | null
          created_at?: string
          id?: string
          methodology?: number | null
          originality?: number | null
          overall_score?: number | null
          quality?: number | null
          recommendation?: Database["public"]["Enums"]["recommendation"] | null
          relevance?: number | null
          status?: Database["public"]["Enums"]["review_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: true
            referencedRelation: "review_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: true
            referencedRelation: "v_review_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string
          permission_code: string
          role_code: string
        }
        Insert: {
          created_at?: string
          permission_code: string
          role_code: string
        }
        Update: {
          created_at?: string
          permission_code?: string
          role_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "role_permissions_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
        ]
      }
      role_requests: {
        Row: {
          conference_id: string
          created_at: string
          id: string
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          role_code: string
          status: string
          user_id: string
        }
        Insert: {
          conference_id: string
          created_at?: string
          id?: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          role_code: string
          status?: string
          user_id: string
        }
        Update: {
          conference_id?: string
          created_at?: string
          id?: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          role_code?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_requests_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          created_at: string
          description: string | null
          name: string
          scope: Database["public"]["Enums"]["role_scope"]
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          name: string
          scope: Database["public"]["Enums"]["role_scope"]
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          name?: string
          scope?: Database["public"]["Enums"]["role_scope"]
        }
        Relationships: []
      }
      rooms: {
        Row: {
          building: string | null
          capacity: number | null
          conference_id: string
          created_at: string
          description: string | null
          equipment: string[]
          floor: string | null
          id: string
          name: string
          room_number: string | null
          status: Database["public"]["Enums"]["room_status"]
          updated_at: string
        }
        Insert: {
          building?: string | null
          capacity?: number | null
          conference_id: string
          created_at?: string
          description?: string | null
          equipment?: string[]
          floor?: string | null
          id?: string
          name: string
          room_number?: string | null
          status?: Database["public"]["Enums"]["room_status"]
          updated_at?: string
        }
        Update: {
          building?: string | null
          capacity?: number | null
          conference_id?: string
          created_at?: string
          description?: string | null
          equipment?: string[]
          floor?: string | null
          id?: string
          name?: string
          room_number?: string | null
          status?: Database["public"]["Enums"]["room_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_slots: {
        Row: {
          conference_id: string
          created_at: string
          ends_at: string
          id: string
          label: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          conference_id: string
          created_at?: string
          ends_at: string
          id?: string
          label: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          conference_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          label?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_slots_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      session_attendance: {
        Row: {
          checked_in_at: string
          conference_id: string
          created_at: string
          id: string
          method: Database["public"]["Enums"]["checkin_method"]
          recorded_by: string | null
          registration_id: string
          session_id: string
          user_id: string
        }
        Insert: {
          checked_in_at?: string
          conference_id: string
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["checkin_method"]
          recorded_by?: string | null
          registration_id: string
          session_id: string
          user_id: string
        }
        Update: {
          checked_in_at?: string
          conference_id?: string
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["checkin_method"]
          recorded_by?: string | null
          registration_id?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_attendance_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_attendance_registration_fk"
            columns: ["registration_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "session_attendance_registration_fk"
            columns: ["registration_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "v_registration_payment_status"
            referencedColumns: ["registration_id", "conference_id"]
          },
          {
            foreignKeyName: "session_attendance_session_fk"
            columns: ["session_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "conference_sessions"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "session_attendance_session_fk"
            columns: ["session_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "v_session_attendance_counts"
            referencedColumns: ["session_id", "conference_id"]
          },
          {
            foreignKeyName: "session_attendance_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      session_chairs: {
        Row: {
          chair_role: Database["public"]["Enums"]["chair_role"]
          created_at: string
          is_active: boolean
          session_id: string
          time_range: unknown
          user_id: string
        }
        Insert: {
          chair_role?: Database["public"]["Enums"]["chair_role"]
          created_at?: string
          is_active?: boolean
          session_id: string
          time_range: unknown
          user_id: string
        }
        Update: {
          chair_role?: Database["public"]["Enums"]["chair_role"]
          created_at?: string
          is_active?: boolean
          session_id?: string
          time_range?: unknown
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_chairs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "conference_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_chairs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "v_session_attendance_counts"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "session_chairs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_authors: {
        Row: {
          affiliation: string | null
          author_order: number
          country: string | null
          created_at: string
          department: string | null
          email: string
          full_name: string
          id: string
          is_corresponding: boolean
          orcid: string | null
          submission_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          affiliation?: string | null
          author_order: number
          country?: string | null
          created_at?: string
          department?: string | null
          email: string
          full_name: string
          id?: string
          is_corresponding?: boolean
          orcid?: string | null
          submission_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          affiliation?: string | null
          author_order?: number
          country?: string | null
          created_at?: string
          department?: string | null
          email?: string
          full_name?: string
          id?: string
          is_corresponding?: boolean
          orcid?: string | null
          submission_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submission_authors_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_authors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_decisions: {
        Row: {
          comments_to_author: string | null
          created_at: string
          decided_at: string
          decided_by: string | null
          decision: Database["public"]["Enums"]["decision"]
          id: string
          internal_notes: string | null
          notified_at: string | null
          round: number
          stage: Database["public"]["Enums"]["decision_stage"]
          submission_id: string
          updated_at: string
        }
        Insert: {
          comments_to_author?: string | null
          created_at?: string
          decided_at?: string
          decided_by?: string | null
          decision: Database["public"]["Enums"]["decision"]
          id?: string
          internal_notes?: string | null
          notified_at?: string | null
          round: number
          stage: Database["public"]["Enums"]["decision_stage"]
          submission_id: string
          updated_at?: string
        }
        Update: {
          comments_to_author?: string | null
          created_at?: string
          decided_at?: string
          decided_by?: string | null
          decision?: Database["public"]["Enums"]["decision"]
          id?: string
          internal_notes?: string | null
          notified_at?: string | null
          round?: number
          stage?: Database["public"]["Enums"]["decision_stage"]
          submission_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_decisions_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_files: {
        Row: {
          checksum_sha256: string | null
          created_at: string
          file_kind: Database["public"]["Enums"]["file_kind"]
          id: string
          is_final: boolean
          mime_type: string
          original_filename: string
          size_bytes: number
          status: Database["public"]["Enums"]["file_status"]
          storage_bucket: string
          storage_path: string
          submission_id: string
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
          version: number
        }
        Insert: {
          checksum_sha256?: string | null
          created_at?: string
          file_kind: Database["public"]["Enums"]["file_kind"]
          id?: string
          is_final?: boolean
          mime_type: string
          original_filename: string
          size_bytes: number
          status?: Database["public"]["Enums"]["file_status"]
          storage_bucket?: string
          storage_path: string
          submission_id: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          version: number
        }
        Update: {
          checksum_sha256?: string | null
          created_at?: string
          file_kind?: Database["public"]["Enums"]["file_kind"]
          id?: string
          is_final?: boolean
          mime_type?: string
          original_filename?: string
          size_bytes?: number
          status?: Database["public"]["Enums"]["file_status"]
          storage_bucket?: string
          storage_path?: string
          submission_id?: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "submission_files_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_status: Database["public"]["Enums"]["submission_status"] | null
          id: number
          reason: string | null
          submission_id: string
          to_status: Database["public"]["Enums"]["submission_status"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["submission_status"] | null
          id?: never
          reason?: string | null
          submission_id: string
          to_status: Database["public"]["Enums"]["submission_status"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["submission_status"] | null
          id?: never
          reason?: string | null
          submission_id?: string
          to_status?: Database["public"]["Enums"]["submission_status"]
        }
        Relationships: [
          {
            foreignKeyName: "submission_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_status_history_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          abstract: string
          conference_id: string
          created_at: string
          created_by: string
          current_round: number
          deleted_at: string | null
          id: string
          keywords: string[]
          presentation_preference: Database["public"]["Enums"]["presentation_pref"]
          status: Database["public"]["Enums"]["submission_status"]
          submission_code: string | null
          submitted_at: string | null
          title: string
          track_id: string
          updated_at: string
          withdrawn_at: string | null
        }
        Insert: {
          abstract?: string
          conference_id: string
          created_at?: string
          created_by: string
          current_round?: number
          deleted_at?: string | null
          id?: string
          keywords?: string[]
          presentation_preference?: Database["public"]["Enums"]["presentation_pref"]
          status?: Database["public"]["Enums"]["submission_status"]
          submission_code?: string | null
          submitted_at?: string | null
          title: string
          track_id: string
          updated_at?: string
          withdrawn_at?: string | null
        }
        Update: {
          abstract?: string
          conference_id?: string
          created_at?: string
          created_by?: string
          current_round?: number
          deleted_at?: string | null
          id?: string
          keywords?: string[]
          presentation_preference?: Database["public"]["Enums"]["presentation_pref"]
          status?: Database["public"]["Enums"]["submission_status"]
          submission_code?: string | null
          submitted_at?: string | null
          title?: string
          track_id?: string
          updated_at?: string
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submissions_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_track_fk"
            columns: ["track_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "conference_tracks"
            referencedColumns: ["id", "conference_id"]
          },
        ]
      }
    }
    Views: {
      v_attendance_daily: {
        Row: {
          attendance_date: string | null
          checked_in: number | null
          conference_id: string | null
          via_manual: number | null
          via_qr: number | null
        }
        Relationships: []
      }
      v_certificate_summary: {
        Row: {
          certificate_type:
            | Database["public"]["Enums"]["certificate_type"]
            | null
          conference_id: string | null
          issued: number | null
          pdf_pending: number | null
          revoked: number | null
        }
        Relationships: [
          {
            foreignKeyName: "certificates_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      v_registration_payment_status: {
        Row: {
          amount_due: number | null
          amount_paid: number | null
          balance: number | null
          category_id: string | null
          conference_id: string | null
          currency: string | null
          payment_state: string | null
          registration_id: string | null
          registration_number: string | null
          registration_status:
            | Database["public"]["Enums"]["registration_status"]
            | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registrations_category_fk"
            columns: ["category_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "registration_categories"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "registrations_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_review_assignments: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          cancel_reason: string | null
          completed_at: string | null
          conference_id: string | null
          created_at: string | null
          due_at: string | null
          id: string | null
          is_overdue: boolean | null
          responded_at: string | null
          reviewer_id: string | null
          round: number | null
          status: Database["public"]["Enums"]["assignment_status"] | null
          submission_code: string | null
          submission_id: string | null
          submission_title: string | null
          track_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_assignments_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_assignments_submission_fk"
            columns: ["submission_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id", "conference_id"]
          },
        ]
      }
      v_reviewer_workload: {
        Row: {
          completed: number | null
          conference_id: string | null
          declined: number | null
          overdue: number | null
          pending: number | null
          reviewer_id: string | null
          total_assigned: number | null
        }
        Relationships: [
          {
            foreignKeyName: "review_assignments_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_room_utilization: {
        Row: {
          capacity: number | null
          conference_id: string | null
          room_id: string | null
          room_name: string | null
          scheduled_minutes: number | null
          sessions: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rooms_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      v_session_attendance_counts: {
        Row: {
          attendees: number | null
          capacity: number | null
          conference_id: string | null
          room_name: string | null
          session_id: string | null
          starts_at: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conference_sessions_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      v_submission_statistics: {
        Row: {
          conference_id: string | null
          status: Database["public"]["Enums"]["submission_status"] | null
          submissions: number | null
          track_id: string | null
          track_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submissions_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_track_fk"
            columns: ["track_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "conference_tracks"
            referencedColumns: ["id", "conference_id"]
          },
        ]
      }
    }
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string }
      appoint_convenor: {
        Args: { p_conference_id: string; p_email: string }
        Returns: undefined
      }
      cancel_my_registration: {
        Args: { p_registration_id: string }
        Returns: undefined
      }
      check_in_by_qr: {
        Args: { p_qr_token: string; p_session_id?: string }
        Returns: Json
      }
      get_my_role_requests: {
        Args: never
        Returns: {
          conference_code: string
          conference_id: string
          conference_name: string
          created_at: string
          id: string
          reject_reason: string
          role_code: string
          status: string
        }[]
      }
      get_my_roles: {
        Args: never
        Returns: {
          conference_code: string
          conference_id: string
          conference_name: string
          conference_status: Database["public"]["Enums"]["conference_status"]
          role_code: string
        }[]
      }
      get_public_committees: {
        Args: { p_conference_id: string }
        Returns: {
          affiliation: string
          committee_id: string
          committee_name: string
          committee_type: Database["public"]["Enums"]["committee_type"]
          country: string
          member_name: string
          member_role: Database["public"]["Enums"]["committee_member_role"]
        }[]
      }
      get_public_schedule: {
        Args: { p_conference_id: string }
        Returns: {
          authors: string
          building: string
          chairs: string
          presentation_ends_at: string
          presentation_id: string
          presentation_order: number
          presentation_starts_at: string
          presentation_title: string
          presenter_name: string
          room_name: string
          session_ends_at: string
          session_id: string
          session_starts_at: string
          session_title: string
          session_type: Database["public"]["Enums"]["session_type"]
          slot_label: string
          submission_code: string
          track_name: string
        }[]
      }
      get_public_team: {
        Args: { p_conference_id: string }
        Returns: {
          full_name: string
          institution: string
          photo_path: string
          position: string
          role_code: string
          title: string
        }[]
      }
      get_role_requests: {
        Args: { p_conference_id: string }
        Returns: {
          applicant_email: string
          applicant_id: string
          applicant_name: string
          applicant_phone: string
          created_at: string
          id: string
          reject_reason: string
          reviewed_at: string
          role_code: string
          status: string
        }[]
      }
      get_submission_feedback: {
        Args: { p_submission_id: string }
        Returns: {
          comments_to_author: string
          decided_at: string
          decision: Database["public"]["Enums"]["decision"]
          decision_comments: string
          methodology: number
          originality: number
          overall_score: number
          quality: number
          recommendation: Database["public"]["Enums"]["recommendation"]
          relevance: number
          review_number: number
          round: number
          stage: Database["public"]["Enums"]["decision_stage"]
        }[]
      }
      mark_all_notifications_read: { Args: never; Returns: number }
      review_role_request: {
        Args: { p_approve: boolean; p_reason?: string; p_request_id: string }
        Returns: {
          conference_id: string
          created_at: string
          id: string
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          role_code: string
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "role_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      verify_certificate: {
        Args: { p_code: string }
        Returns: {
          certificate_number: string
          certificate_type: Database["public"]["Enums"]["certificate_type"]
          conference_name: string
          is_valid: boolean
          issued_at: string
          recipient_name: string
          status: Database["public"]["Enums"]["certificate_status"]
        }[]
      }
      withdraw_submission: {
        Args: { p_reason?: string; p_submission_id: string }
        Returns: undefined
      }
    }
    Enums: {
      announcement_status: "draft" | "scheduled" | "published" | "archived"
      assignment_status:
        | "assigned"
        | "in_progress"
        | "completed"
        | "declined"
        | "cancelled"
      audience:
        | "all"
        | "authors"
        | "reviewers"
        | "attendees"
        | "staff"
        | "speakers"
        | "chairs"
      certificate_status: "issued" | "revoked"
      certificate_type:
        | "participation"
        | "presentation"
        | "speaker"
        | "reviewer"
        | "session_chair"
        | "staff"
        | "best_paper"
      chair_role: "chair" | "co_chair"
      checkin_method: "qr" | "manual"
      coi_source: "author_declared" | "reviewer_declared" | "manager_flagged"
      committee_member_role: "chair" | "co_chair" | "secretary" | "member"
      committee_type:
        | "organizing"
        | "program"
        | "technical"
        | "review"
        | "registration"
        | "advisory"
        | "other"
      conference_status:
        | "draft"
        | "registration_open"
        | "submission_open"
        | "under_review"
        | "scheduling"
        | "published"
        | "ongoing"
        | "completed"
        | "closed"
      decision: "accepted" | "rejected" | "revision_required"
      decision_stage: "abstract" | "full_paper" | "final_approval"
      email_status: "queued" | "sent" | "delivered" | "bounced" | "failed"
      fee_type: "early_bird" | "regular" | "late" | "on_site"
      file_kind:
        | "abstract"
        | "full_paper"
        | "camera_ready"
        | "supplementary"
        | "slides"
      file_status: "pending" | "active" | "superseded" | "rejected"
      invitation_status: "pending" | "accepted" | "expired" | "revoked"
      member_status: "active" | "removed"
      notification_type:
        | "submission"
        | "review"
        | "acceptance"
        | "rejection"
        | "deadline"
        | "schedule"
        | "payment"
        | "certificate"
        | "announcement"
        | "system"
      payment_method:
        | "esewa"
        | "khalti"
        | "fonepay"
        | "stripe"
        | "bank_transfer"
        | "cash"
        | "other"
      payment_status:
        | "pending"
        | "successful"
        | "failed"
        | "refunded"
        | "cancelled"
      presentation_pref: "oral" | "poster" | "either"
      presentation_status:
        | "scheduled"
        | "confirmed"
        | "presented"
        | "absent"
        | "cancelled"
      recommendation: "accept" | "minor_revision" | "major_revision" | "reject"
      registration_status: "pending" | "confirmed" | "waitlisted" | "cancelled"
      review_mode: "open" | "single_blind" | "double_blind"
      review_status: "draft" | "submitted"
      role_scope: "platform" | "conference" | "derived"
      room_status: "active" | "inactive"
      session_status:
        | "draft"
        | "published"
        | "ongoing"
        | "completed"
        | "cancelled"
      session_type:
        | "paper"
        | "keynote"
        | "panel"
        | "workshop"
        | "poster"
        | "opening"
        | "closing"
        | "break"
      speaker_type: "keynote" | "invited" | "panelist" | "guest"
      submission_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "revision_required"
        | "accepted"
        | "rejected"
        | "full_paper_pending"
        | "full_paper_submitted"
        | "final_approved"
        | "scheduled"
        | "presented"
        | "completed"
        | "withdrawn"
      user_status: "active" | "suspended" | "deactivated"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      announcement_status: ["draft", "scheduled", "published", "archived"],
      assignment_status: [
        "assigned",
        "in_progress",
        "completed",
        "declined",
        "cancelled",
      ],
      audience: [
        "all",
        "authors",
        "reviewers",
        "attendees",
        "staff",
        "speakers",
        "chairs",
      ],
      certificate_status: ["issued", "revoked"],
      certificate_type: [
        "participation",
        "presentation",
        "speaker",
        "reviewer",
        "session_chair",
        "staff",
        "best_paper",
      ],
      chair_role: ["chair", "co_chair"],
      checkin_method: ["qr", "manual"],
      coi_source: ["author_declared", "reviewer_declared", "manager_flagged"],
      committee_member_role: ["chair", "co_chair", "secretary", "member"],
      committee_type: [
        "organizing",
        "program",
        "technical",
        "review",
        "registration",
        "advisory",
        "other",
      ],
      conference_status: [
        "draft",
        "registration_open",
        "submission_open",
        "under_review",
        "scheduling",
        "published",
        "ongoing",
        "completed",
        "closed",
      ],
      decision: ["accepted", "rejected", "revision_required"],
      decision_stage: ["abstract", "full_paper", "final_approval"],
      email_status: ["queued", "sent", "delivered", "bounced", "failed"],
      fee_type: ["early_bird", "regular", "late", "on_site"],
      file_kind: [
        "abstract",
        "full_paper",
        "camera_ready",
        "supplementary",
        "slides",
      ],
      file_status: ["pending", "active", "superseded", "rejected"],
      invitation_status: ["pending", "accepted", "expired", "revoked"],
      member_status: ["active", "removed"],
      notification_type: [
        "submission",
        "review",
        "acceptance",
        "rejection",
        "deadline",
        "schedule",
        "payment",
        "certificate",
        "announcement",
        "system",
      ],
      payment_method: [
        "esewa",
        "khalti",
        "fonepay",
        "stripe",
        "bank_transfer",
        "cash",
        "other",
      ],
      payment_status: [
        "pending",
        "successful",
        "failed",
        "refunded",
        "cancelled",
      ],
      presentation_pref: ["oral", "poster", "either"],
      presentation_status: [
        "scheduled",
        "confirmed",
        "presented",
        "absent",
        "cancelled",
      ],
      recommendation: ["accept", "minor_revision", "major_revision", "reject"],
      registration_status: ["pending", "confirmed", "waitlisted", "cancelled"],
      review_mode: ["open", "single_blind", "double_blind"],
      review_status: ["draft", "submitted"],
      role_scope: ["platform", "conference", "derived"],
      room_status: ["active", "inactive"],
      session_status: [
        "draft",
        "published",
        "ongoing",
        "completed",
        "cancelled",
      ],
      session_type: [
        "paper",
        "keynote",
        "panel",
        "workshop",
        "poster",
        "opening",
        "closing",
        "break",
      ],
      speaker_type: ["keynote", "invited", "panelist", "guest"],
      submission_status: [
        "draft",
        "submitted",
        "under_review",
        "revision_required",
        "accepted",
        "rejected",
        "full_paper_pending",
        "full_paper_submitted",
        "final_approved",
        "scheduled",
        "presented",
        "completed",
        "withdrawn",
      ],
      user_status: ["active", "suspended", "deactivated"],
    },
  },
} as const
