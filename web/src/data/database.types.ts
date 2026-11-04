export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      academic_term: {
        Row: {
          end_date: string;
          name: string;
          start_date: string;
          term_id: string;
        };
        ComputedFields: never;
        Insert: {
          end_date: string;
          name: string;
          start_date: string;
          term_id: string;
        };
        Update: {
          end_date?: string;
          name?: string;
          start_date?: string;
          term_id?: string;
        };
        Relationships: [];
      };
      app_user: {
        Row: {
          created_at: string;
          faculty_id: string | null;
          role: string;
          user_id: string;
          usn: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          faculty_id?: string | null;
          role: string;
          user_id: string;
          usn?: string | null;
        };
        Update: {
          created_at?: string;
          faculty_id?: string | null;
          role?: string;
          user_id?: string;
          usn?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "app_user_faculty_id_fkey";
            columns: ["faculty_id"];
            isOneToOne: true;
            referencedRelation: "faculty";
            referencedColumns: ["faculty_id"];
          },
          {
            foreignKeyName: "app_user_usn_fkey";
            columns: ["usn"];
            isOneToOne: true;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
        ];
      };
      artifact: {
        Row: {
          artifact_id: string;
          created_at: string;
          external_ref: string | null;
          milestone_no: number;
          owner_usn: string | null;
          project_id: string;
          source: string;
          team_id: string;
          title: string;
          type: string;
          visibility: string;
        };
        ComputedFields: never;
        Insert: {
          artifact_id: string;
          created_at?: string;
          external_ref?: string | null;
          milestone_no: number;
          owner_usn?: string | null;
          project_id: string;
          source: string;
          team_id: string;
          title: string;
          type: string;
          visibility?: string;
        };
        Update: {
          artifact_id?: string;
          created_at?: string;
          external_ref?: string | null;
          milestone_no?: number;
          owner_usn?: string | null;
          project_id?: string;
          source?: string;
          team_id?: string;
          title?: string;
          type?: string;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: "artifact_owner_usn_fkey";
            columns: ["owner_usn"];
            isOneToOne: false;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
          {
            foreignKeyName: "artifact_project_id_milestone_no_fkey";
            columns: ["project_id", "milestone_no"];
            isOneToOne: false;
            referencedRelation: "milestone";
            referencedColumns: ["project_id", "milestone_no"];
          },
          {
            foreignKeyName: "artifact_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "team";
            referencedColumns: ["team_id"];
          },
          {
            foreignKeyName: "artifact_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "v_faculty_team_progress";
            referencedColumns: ["team_id"];
          },
          {
            foreignKeyName: "artifact_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "v_lab_cie_marks";
            referencedColumns: ["team_id"];
          },
          {
            foreignKeyName: "artifact_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "v_rubric_sheet";
            referencedColumns: ["team_id"];
          },
          {
            foreignKeyName: "artifact_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "v_semester_hub";
            referencedColumns: ["team_id"];
          },
          {
            foreignKeyName: "artifact_team_project_fkey";
            columns: ["team_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "team";
            referencedColumns: ["team_id", "project_id"];
          },
          {
            foreignKeyName: "artifact_team_project_fkey";
            columns: ["team_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "v_lab_cie_marks";
            referencedColumns: ["team_id", "project_id"];
          },
          {
            foreignKeyName: "artifact_team_project_fkey";
            columns: ["team_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "v_rubric_sheet";
            referencedColumns: ["team_id", "project_id"];
          },
        ];
      };
      artifact_chunk: {
        Row: {
          artifact_id: string;
          author_usn: string;
          chunk_id: number;
          chunk_no: number | null;
          content: string;
          content_hash: string | null;
          created_at: string;
          embedding: string | null;
          embedding_model: string | null;
          tsv: unknown;
          version_no: number;
          visibility: string;
        };
        ComputedFields: never;
        Insert: {
          artifact_id: string;
          author_usn: string;
          chunk_id?: number;
          chunk_no?: number | null;
          content: string;
          content_hash?: string | null;
          created_at?: string;
          embedding?: string | null;
          embedding_model?: string | null;
          tsv?: never;
          version_no: number;
          visibility?: string;
        };
        Update: {
          artifact_id?: string;
          author_usn?: string;
          chunk_id?: number;
          chunk_no?: number | null;
          content?: string;
          content_hash?: string | null;
          created_at?: string;
          embedding?: string | null;
          embedding_model?: string | null;
          tsv?: never;
          version_no?: number;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: "artifact_chunk_artifact_id_fkey";
            columns: ["artifact_id"];
            isOneToOne: false;
            referencedRelation: "artifact";
            referencedColumns: ["artifact_id"];
          },
          {
            foreignKeyName: "artifact_chunk_author_usn_fkey";
            columns: ["author_usn"];
            isOneToOne: false;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
        ];
      };
      artifact_version: {
        Row: {
          ai_assistance: string;
          artifact_id: string;
          content_hash: string | null;
          created_at: string;
          created_by: string;
          mongo_ref: string | null;
          source_ref: string | null;
          version_no: number;
        };
        ComputedFields: never;
        Insert: {
          ai_assistance?: string;
          artifact_id: string;
          content_hash?: string | null;
          created_at?: string;
          created_by: string;
          mongo_ref?: string | null;
          source_ref?: string | null;
          version_no: number;
        };
        Update: {
          ai_assistance?: string;
          artifact_id?: string;
          content_hash?: string | null;
          created_at?: string;
          created_by?: string;
          mongo_ref?: string | null;
          source_ref?: string | null;
          version_no?: number;
        };
        Relationships: [
          {
            foreignKeyName: "artifact_version_artifact_id_fkey";
            columns: ["artifact_id"];
            isOneToOne: false;
            referencedRelation: "artifact";
            referencedColumns: ["artifact_id"];
          },
          {
            foreignKeyName: "artifact_version_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
        ];
      };
      assessment: {
        Row: {
          assessed_at: string;
          assessed_by: string;
          marks: number;
          milestone_no: number;
          project_id: string;
          remarks: string | null;
          usn: string;
        };
        ComputedFields: never;
        Insert: {
          assessed_at?: string;
          assessed_by: string;
          marks: number;
          milestone_no: number;
          project_id: string;
          remarks?: string | null;
          usn: string;
        };
        Update: {
          assessed_at?: string;
          assessed_by?: string;
          marks?: number;
          milestone_no?: number;
          project_id?: string;
          remarks?: string | null;
          usn?: string;
        };
        Relationships: [
          {
            foreignKeyName: "assessment_assessed_by_fkey";
            columns: ["assessed_by"];
            isOneToOne: false;
            referencedRelation: "faculty";
            referencedColumns: ["faculty_id"];
          },
          {
            foreignKeyName: "assessment_project_id_milestone_no_fkey";
            columns: ["project_id", "milestone_no"];
            isOneToOne: false;
            referencedRelation: "milestone";
            referencedColumns: ["project_id", "milestone_no"];
          },
          {
            foreignKeyName: "assessment_usn_fkey";
            columns: ["usn"];
            isOneToOne: false;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
        ];
      };
      claim: {
        Row: {
          ai_assistance: string;
          claim_id: number;
          contribution_type: string | null;
          created_at: string;
          milestone_no: number;
          project_id: string;
          revision: number;
          statement: string;
          status: string;
          team_id: string;
          usn: string;
        };
        ComputedFields: never;
        Insert: {
          ai_assistance?: string;
          claim_id?: number;
          contribution_type?: string | null;
          created_at?: string;
          milestone_no: number;
          project_id: string;
          revision?: number;
          statement: string;
          status?: string;
          team_id: string;
          usn: string;
        };
        Update: {
          ai_assistance?: string;
          claim_id?: number;
          contribution_type?: string | null;
          created_at?: string;
          milestone_no?: number;
          project_id?: string;
          revision?: number;
          statement?: string;
          status?: string;
          team_id?: string;
          usn?: string;
        };
        Relationships: [
          {
            foreignKeyName: "claim_project_id_milestone_no_fkey";
            columns: ["project_id", "milestone_no"];
            isOneToOne: false;
            referencedRelation: "milestone";
            referencedColumns: ["project_id", "milestone_no"];
          },
          {
            foreignKeyName: "claim_team_id_project_id_fkey";
            columns: ["team_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "team";
            referencedColumns: ["team_id", "project_id"];
          },
          {
            foreignKeyName: "claim_team_id_project_id_fkey";
            columns: ["team_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "v_lab_cie_marks";
            referencedColumns: ["team_id", "project_id"];
          },
          {
            foreignKeyName: "claim_team_id_project_id_fkey";
            columns: ["team_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "v_rubric_sheet";
            referencedColumns: ["team_id", "project_id"];
          },
          {
            foreignKeyName: "claim_usn_fkey";
            columns: ["usn"];
            isOneToOne: false;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
        ];
      };
      claim_evidence: {
        Row: {
          added_at: string;
          artifact_id: string | null;
          claim_id: number;
          contribution_id: number | null;
          evidence_no: number;
          kind: string;
          note: string | null;
          ref: string | null;
          version_no: number | null;
        };
        ComputedFields: never;
        Insert: {
          added_at?: string;
          artifact_id?: string | null;
          claim_id: number;
          contribution_id?: number | null;
          evidence_no: number;
          kind: string;
          note?: string | null;
          ref?: string | null;
          version_no?: number | null;
        };
        Update: {
          added_at?: string;
          artifact_id?: string | null;
          claim_id?: number;
          contribution_id?: number | null;
          evidence_no?: number;
          kind?: string;
          note?: string | null;
          ref?: string | null;
          version_no?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "claim_evidence_artifact_id_version_no_fkey";
            columns: ["artifact_id", "version_no"];
            isOneToOne: false;
            referencedRelation: "artifact_version";
            referencedColumns: ["artifact_id", "version_no"];
          },
          {
            foreignKeyName: "claim_evidence_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: false;
            referencedRelation: "claim";
            referencedColumns: ["claim_id"];
          },
          {
            foreignKeyName: "claim_evidence_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: false;
            referencedRelation: "v_contested_claims";
            referencedColumns: ["claim_id"];
          },
          {
            foreignKeyName: "claim_evidence_contribution_id_fkey";
            columns: ["contribution_id"];
            isOneToOne: false;
            referencedRelation: "contribution";
            referencedColumns: ["contribution_id"];
          },
        ];
      };
      contribution: {
        Row: {
          ai_assisted: boolean;
          artifact_id: string;
          contribution_id: number;
          contribution_type: string;
          created_at: string;
          description: string | null;
          occurred_at: string | null;
          source: string;
          source_ref: string | null;
          usn: string;
        };
        ComputedFields: never;
        Insert: {
          ai_assisted?: boolean;
          artifact_id: string;
          contribution_id?: number;
          contribution_type: string;
          created_at?: string;
          description?: string | null;
          occurred_at?: string | null;
          source?: string;
          source_ref?: string | null;
          usn: string;
        };
        Update: {
          ai_assisted?: boolean;
          artifact_id?: string;
          contribution_id?: number;
          contribution_type?: string;
          created_at?: string;
          description?: string | null;
          occurred_at?: string | null;
          source?: string;
          source_ref?: string | null;
          usn?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contribution_artifact_id_fkey";
            columns: ["artifact_id"];
            isOneToOne: false;
            referencedRelation: "artifact";
            referencedColumns: ["artifact_id"];
          },
          {
            foreignKeyName: "contribution_usn_fkey";
            columns: ["usn"];
            isOneToOne: false;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
        ];
      };
      countersign: {
        Row: {
          claim_id: number;
          claim_revision: number;
          comment: string | null;
          endorser_usn: string;
          signed_at: string;
          verdict: string;
        };
        ComputedFields: never;
        Insert: {
          claim_id: number;
          claim_revision: number;
          comment?: string | null;
          endorser_usn: string;
          signed_at?: string;
          verdict: string;
        };
        Update: {
          claim_id?: number;
          claim_revision?: number;
          comment?: string | null;
          endorser_usn?: string;
          signed_at?: string;
          verdict?: string;
        };
        Relationships: [
          {
            foreignKeyName: "countersign_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: false;
            referencedRelation: "claim";
            referencedColumns: ["claim_id"];
          },
          {
            foreignKeyName: "countersign_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: false;
            referencedRelation: "v_contested_claims";
            referencedColumns: ["claim_id"];
          },
          {
            foreignKeyName: "countersign_endorser_usn_fkey";
            columns: ["endorser_usn"];
            isOneToOne: false;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
        ];
      };
      course: {
        Row: {
          course_code: string;
          credits: number;
          faculty_id: string | null;
          semester: number;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          course_code: string;
          credits: number;
          faculty_id?: string | null;
          semester: number;
          title: string;
        };
        Update: {
          course_code?: string;
          credits?: number;
          faculty_id?: string | null;
          semester?: number;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "course_faculty_id_fkey";
            columns: ["faculty_id"];
            isOneToOne: false;
            referencedRelation: "faculty";
            referencedColumns: ["faculty_id"];
          },
        ];
      };
      course_offering: {
        Row: {
          course_code: string;
          faculty_id: string;
          offering_id: number;
          section: string;
          term_id: string;
        };
        ComputedFields: never;
        Insert: {
          course_code: string;
          faculty_id: string;
          offering_id?: number;
          section: string;
          term_id: string;
        };
        Update: {
          course_code?: string;
          faculty_id?: string;
          offering_id?: number;
          section?: string;
          term_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "course_offering_course_code_fkey";
            columns: ["course_code"];
            isOneToOne: false;
            referencedRelation: "course";
            referencedColumns: ["course_code"];
          },
          {
            foreignKeyName: "course_offering_faculty_id_fkey";
            columns: ["faculty_id"];
            isOneToOne: false;
            referencedRelation: "faculty";
            referencedColumns: ["faculty_id"];
          },
          {
            foreignKeyName: "course_offering_term_id_fkey";
            columns: ["term_id"];
            isOneToOne: false;
            referencedRelation: "academic_term";
            referencedColumns: ["term_id"];
          },
        ];
      };
      course_skill: {
        Row: {
          course_code: string;
          skill_id: string;
        };
        ComputedFields: never;
        Insert: {
          course_code: string;
          skill_id: string;
        };
        Update: {
          course_code?: string;
          skill_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "course_skill_course_code_fkey";
            columns: ["course_code"];
            isOneToOne: false;
            referencedRelation: "course";
            referencedColumns: ["course_code"];
          },
          {
            foreignKeyName: "course_skill_skill_id_fkey";
            columns: ["skill_id"];
            isOneToOne: false;
            referencedRelation: "skill";
            referencedColumns: ["skill_id"];
          },
        ];
      };
      enrollment: {
        Row: {
          enrolled_on: string;
          offering_id: number;
          usn: string;
        };
        ComputedFields: never;
        Insert: {
          enrolled_on?: string;
          offering_id: number;
          usn: string;
        };
        Update: {
          enrolled_on?: string;
          offering_id?: number;
          usn?: string;
        };
        Relationships: [
          {
            foreignKeyName: "enrollment_offering_id_fkey";
            columns: ["offering_id"];
            isOneToOne: false;
            referencedRelation: "course_offering";
            referencedColumns: ["offering_id"];
          },
          {
            foreignKeyName: "enrollment_offering_id_fkey";
            columns: ["offering_id"];
            isOneToOne: false;
            referencedRelation: "v_semester_hub";
            referencedColumns: ["offering_id"];
          },
          {
            foreignKeyName: "enrollment_usn_fkey";
            columns: ["usn"];
            isOneToOne: false;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
        ];
      };
      faculty: {
        Row: {
          department: string;
          designation: string;
          email: string;
          faculty_id: string;
          name: string;
        };
        ComputedFields: never;
        Insert: {
          department: string;
          designation: string;
          email: string;
          faculty_id: string;
          name: string;
        };
        Update: {
          department?: string;
          designation?: string;
          email?: string;
          faculty_id?: string;
          name?: string;
        };
        Relationships: [];
      };
      ingest_event: {
        Row: {
          attempts: number;
          commit_count: number | null;
          contribution_count: number | null;
          delivery_id: string;
          error: string | null;
          event_type: string;
          followups_at: string | null;
          mongo_id: string | null;
          msg_id: number | null;
          projected_at: string | null;
          push_after: string | null;
          push_ref: string | null;
          received_at: string;
          repo_full_name: string | null;
          sender_login: string | null;
          source: string;
          status: string;
          team_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          commit_count?: number | null;
          contribution_count?: number | null;
          delivery_id: string;
          error?: string | null;
          event_type: string;
          followups_at?: string | null;
          mongo_id?: string | null;
          msg_id?: number | null;
          projected_at?: string | null;
          push_after?: string | null;
          push_ref?: string | null;
          received_at?: string;
          repo_full_name?: string | null;
          sender_login?: string | null;
          source?: string;
          status?: string;
          team_id?: string | null;
        };
        Update: {
          attempts?: number;
          commit_count?: number | null;
          contribution_count?: number | null;
          delivery_id?: string;
          error?: string | null;
          event_type?: string;
          followups_at?: string | null;
          mongo_id?: string | null;
          msg_id?: number | null;
          projected_at?: string | null;
          push_after?: string | null;
          push_ref?: string | null;
          received_at?: string;
          repo_full_name?: string | null;
          sender_login?: string | null;
          source?: string;
          status?: string;
          team_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ingest_event_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "team";
            referencedColumns: ["team_id"];
          },
          {
            foreignKeyName: "ingest_event_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "v_faculty_team_progress";
            referencedColumns: ["team_id"];
          },
          {
            foreignKeyName: "ingest_event_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "v_lab_cie_marks";
            referencedColumns: ["team_id"];
          },
          {
            foreignKeyName: "ingest_event_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "v_rubric_sheet";
            referencedColumns: ["team_id"];
          },
          {
            foreignKeyName: "ingest_event_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "v_semester_hub";
            referencedColumns: ["team_id"];
          },
        ];
      };
      milestone: {
        Row: {
          cie_part: string;
          counts_in_reduced: boolean | null;
          deadline: string;
          locked_at: string | null;
          max_marks: number;
          milestone_no: number;
          project_id: string;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          cie_part?: string;
          counts_in_reduced?: never;
          deadline: string;
          locked_at?: string | null;
          max_marks: number;
          milestone_no: number;
          project_id: string;
          title: string;
        };
        Update: {
          cie_part?: string;
          counts_in_reduced?: never;
          deadline?: string;
          locked_at?: string | null;
          max_marks?: number;
          milestone_no?: number;
          project_id?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "milestone_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "project";
            referencedColumns: ["project_id"];
          },
          {
            foreignKeyName: "milestone_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "v_faculty_team_progress";
            referencedColumns: ["project_id"];
          },
          {
            foreignKeyName: "milestone_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "v_semester_hub";
            referencedColumns: ["project_id"];
          },
        ];
      };
      project: {
        Row: {
          course_code: string;
          description: string | null;
          end_date: string;
          offering_id: number | null;
          project_id: string;
          start_date: string;
          status: string;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          course_code: string;
          description?: string | null;
          end_date: string;
          offering_id?: number | null;
          project_id: string;
          start_date: string;
          status?: string;
          title: string;
        };
        Update: {
          course_code?: string;
          description?: string | null;
          end_date?: string;
          offering_id?: number | null;
          project_id?: string;
          start_date?: string;
          status?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_course_code_fkey";
            columns: ["course_code"];
            isOneToOne: false;
            referencedRelation: "course";
            referencedColumns: ["course_code"];
          },
          {
            foreignKeyName: "project_offering_fkey";
            columns: ["offering_id", "course_code"];
            isOneToOne: false;
            referencedRelation: "course_offering";
            referencedColumns: ["offering_id", "course_code"];
          },
          {
            foreignKeyName: "project_offering_fkey";
            columns: ["offering_id", "course_code"];
            isOneToOne: false;
            referencedRelation: "v_semester_hub";
            referencedColumns: ["offering_id", "course_code"];
          },
        ];
      };
      project_skill: {
        Row: {
          min_level: number;
          project_id: string;
          skill_id: string;
        };
        ComputedFields: never;
        Insert: {
          min_level?: number;
          project_id: string;
          skill_id: string;
        };
        Update: {
          min_level?: number;
          project_id?: string;
          skill_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_skill_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "project";
            referencedColumns: ["project_id"];
          },
          {
            foreignKeyName: "project_skill_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "v_faculty_team_progress";
            referencedColumns: ["project_id"];
          },
          {
            foreignKeyName: "project_skill_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "v_semester_hub";
            referencedColumns: ["project_id"];
          },
          {
            foreignKeyName: "project_skill_skill_id_fkey";
            columns: ["skill_id"];
            isOneToOne: false;
            referencedRelation: "skill";
            referencedColumns: ["skill_id"];
          },
        ];
      };
      skill: {
        Row: {
          category: string;
          name: string;
          parent_skill_id: string | null;
          skill_id: string;
        };
        ComputedFields: never;
        Insert: {
          category: string;
          name: string;
          parent_skill_id?: string | null;
          skill_id: string;
        };
        Update: {
          category?: string;
          name?: string;
          parent_skill_id?: string | null;
          skill_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "skill_parent_skill_id_fkey";
            columns: ["parent_skill_id"];
            isOneToOne: false;
            referencedRelation: "skill";
            referencedColumns: ["skill_id"];
          },
        ];
      };
      skill_evidence: {
        Row: {
          claim_id: number | null;
          contribution_id: number | null;
          created_at: string;
          evidence_id: number;
          level: number;
          skill_id: string;
          usn: string;
        };
        ComputedFields: never;
        Insert: {
          claim_id?: number | null;
          contribution_id?: number | null;
          created_at?: string;
          evidence_id?: number;
          level: number;
          skill_id: string;
          usn: string;
        };
        Update: {
          claim_id?: number | null;
          contribution_id?: number | null;
          created_at?: string;
          evidence_id?: number;
          level?: number;
          skill_id?: string;
          usn?: string;
        };
        Relationships: [
          {
            foreignKeyName: "skill_evidence_claim_fkey";
            columns: ["claim_id", "usn"];
            isOneToOne: false;
            referencedRelation: "claim";
            referencedColumns: ["claim_id", "usn"];
          },
          {
            foreignKeyName: "skill_evidence_claim_fkey";
            columns: ["claim_id", "usn"];
            isOneToOne: false;
            referencedRelation: "v_contested_claims";
            referencedColumns: ["claim_id", "usn"];
          },
          {
            foreignKeyName: "skill_evidence_contribution_fkey";
            columns: ["contribution_id", "usn"];
            isOneToOne: false;
            referencedRelation: "contribution";
            referencedColumns: ["contribution_id", "usn"];
          },
          {
            foreignKeyName: "skill_evidence_skill_id_fkey";
            columns: ["skill_id"];
            isOneToOne: false;
            referencedRelation: "skill";
            referencedColumns: ["skill_id"];
          },
          {
            foreignKeyName: "skill_evidence_usn_fkey";
            columns: ["usn"];
            isOneToOne: false;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
        ];
      };
      student: {
        Row: {
          department: string;
          email: string;
          joined_at: string;
          name: string;
          section: string;
          semester: number;
          usn: string;
        };
        ComputedFields: never;
        Insert: {
          department: string;
          email: string;
          joined_at: string;
          name: string;
          section: string;
          semester: number;
          usn: string;
        };
        Update: {
          department?: string;
          email?: string;
          joined_at?: string;
          name?: string;
          section?: string;
          semester?: number;
          usn?: string;
        };
        Relationships: [];
      };
      student_identity: {
        Row: {
          created_at: string;
          provider: string;
          provider_login: string;
          provider_user_id: number | null;
          usn: string;
          verified_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          provider: string;
          provider_login: string;
          provider_user_id?: number | null;
          usn: string;
          verified_at?: string | null;
        };
        Update: {
          created_at?: string;
          provider?: string;
          provider_login?: string;
          provider_user_id?: number | null;
          usn?: string;
          verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "student_identity_usn_fkey";
            columns: ["usn"];
            isOneToOne: false;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
        ];
      };
      student_skill: {
        Row: {
          level: number;
          skill_id: string;
          usn: string;
        };
        ComputedFields: never;
        Insert: {
          level: number;
          skill_id: string;
          usn: string;
        };
        Update: {
          level?: number;
          skill_id?: string;
          usn?: string;
        };
        Relationships: [
          {
            foreignKeyName: "student_skill_skill_id_fkey";
            columns: ["skill_id"];
            isOneToOne: false;
            referencedRelation: "skill";
            referencedColumns: ["skill_id"];
          },
          {
            foreignKeyName: "student_skill_usn_fkey";
            columns: ["usn"];
            isOneToOne: false;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
        ];
      };
      submission: {
        Row: {
          attempt_no: number;
          milestone_no: number;
          project_id: string;
          submission_id: number;
          submitted_at: string;
          submitted_by: string;
          team_id: string;
        };
        ComputedFields: never;
        Insert: {
          attempt_no?: number;
          milestone_no: number;
          project_id: string;
          submission_id?: number;
          submitted_at?: string;
          submitted_by: string;
          team_id: string;
        };
        Update: {
          attempt_no?: number;
          milestone_no?: number;
          project_id?: string;
          submission_id?: number;
          submitted_at?: string;
          submitted_by?: string;
          team_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "submission_project_id_milestone_no_fkey";
            columns: ["project_id", "milestone_no"];
            isOneToOne: false;
            referencedRelation: "milestone";
            referencedColumns: ["project_id", "milestone_no"];
          },
          {
            foreignKeyName: "submission_submitted_by_fkey";
            columns: ["submitted_by"];
            isOneToOne: false;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
          {
            foreignKeyName: "submission_team_id_project_id_fkey";
            columns: ["team_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "team";
            referencedColumns: ["team_id", "project_id"];
          },
          {
            foreignKeyName: "submission_team_id_project_id_fkey";
            columns: ["team_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "v_lab_cie_marks";
            referencedColumns: ["team_id", "project_id"];
          },
          {
            foreignKeyName: "submission_team_id_project_id_fkey";
            columns: ["team_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "v_rubric_sheet";
            referencedColumns: ["team_id", "project_id"];
          },
        ];
      };
      submission_artifact: {
        Row: {
          artifact_id: string;
          submission_id: number;
          version_no: number;
        };
        ComputedFields: never;
        Insert: {
          artifact_id: string;
          submission_id: number;
          version_no: number;
        };
        Update: {
          artifact_id?: string;
          submission_id?: number;
          version_no?: number;
        };
        Relationships: [
          {
            foreignKeyName: "submission_artifact_artifact_id_version_no_fkey";
            columns: ["artifact_id", "version_no"];
            isOneToOne: false;
            referencedRelation: "artifact_version";
            referencedColumns: ["artifact_id", "version_no"];
          },
          {
            foreignKeyName: "submission_artifact_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "submission";
            referencedColumns: ["submission_id"];
          },
        ];
      };
      team: {
        Row: {
          abstract: string | null;
          created_at: string;
          max_size: number;
          project_id: string;
          team_id: string;
          team_name: string;
          topic_title: string | null;
        };
        ComputedFields: never;
        Insert: {
          abstract?: string | null;
          created_at?: string;
          max_size: number;
          project_id: string;
          team_id: string;
          team_name: string;
          topic_title?: string | null;
        };
        Update: {
          abstract?: string | null;
          created_at?: string;
          max_size?: number;
          project_id?: string;
          team_id?: string;
          team_name?: string;
          topic_title?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "team_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "project";
            referencedColumns: ["project_id"];
          },
          {
            foreignKeyName: "team_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "v_faculty_team_progress";
            referencedColumns: ["project_id"];
          },
          {
            foreignKeyName: "team_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "v_semester_hub";
            referencedColumns: ["project_id"];
          },
        ];
      };
      team_member: {
        Row: {
          joined_at: string;
          role: string;
          team_id: string;
          usn: string;
        };
        ComputedFields: never;
        Insert: {
          joined_at?: string;
          role?: string;
          team_id: string;
          usn: string;
        };
        Update: {
          joined_at?: string;
          role?: string;
          team_id?: string;
          usn?: string;
        };
        Relationships: [
          {
            foreignKeyName: "team_member_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "team";
            referencedColumns: ["team_id"];
          },
          {
            foreignKeyName: "team_member_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "v_faculty_team_progress";
            referencedColumns: ["team_id"];
          },
          {
            foreignKeyName: "team_member_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "v_lab_cie_marks";
            referencedColumns: ["team_id"];
          },
          {
            foreignKeyName: "team_member_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "v_rubric_sheet";
            referencedColumns: ["team_id"];
          },
          {
            foreignKeyName: "team_member_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "v_semester_hub";
            referencedColumns: ["team_id"];
          },
          {
            foreignKeyName: "team_member_usn_fkey";
            columns: ["usn"];
            isOneToOne: false;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
        ];
      };
      team_repo: {
        Row: {
          added_at: string;
          default_milestone_no: number | null;
          project_id: string;
          purpose: string | null;
          repo_full_name: string;
          team_id: string;
          track_paths: string[] | null;
        };
        ComputedFields: never;
        Insert: {
          added_at?: string;
          default_milestone_no?: number | null;
          project_id: string;
          purpose?: string | null;
          repo_full_name: string;
          team_id: string;
          track_paths?: string[] | null;
        };
        Update: {
          added_at?: string;
          default_milestone_no?: number | null;
          project_id?: string;
          purpose?: string | null;
          repo_full_name?: string;
          team_id?: string;
          track_paths?: string[] | null;
        };
        Relationships: [
          {
            foreignKeyName: "team_repo_milestone_fkey";
            columns: ["project_id", "default_milestone_no"];
            isOneToOne: false;
            referencedRelation: "milestone";
            referencedColumns: ["project_id", "milestone_no"];
          },
          {
            foreignKeyName: "team_repo_team_fkey";
            columns: ["team_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "team";
            referencedColumns: ["team_id", "project_id"];
          },
          {
            foreignKeyName: "team_repo_team_fkey";
            columns: ["team_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "v_lab_cie_marks";
            referencedColumns: ["team_id", "project_id"];
          },
          {
            foreignKeyName: "team_repo_team_fkey";
            columns: ["team_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "v_rubric_sheet";
            referencedColumns: ["team_id", "project_id"];
          },
        ];
      };
    };
    Views: {
      v_contested_claims: {
        Row: {
          ai_assistance: string;
          claim_id: number;
          claimant: string;
          component: string;
          confirms: number | null;
          created_at: string;
          disputes: number | null;
          last_disputed_at: string | null;
          milestone_no: number;
          project_id: string;
          statement: string;
          team_id: string;
          team_name: string;
          usn: string;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "claim_project_id_milestone_no_fkey";
            columns: ["project_id", "milestone_no"];
            isOneToOne: false;
            referencedRelation: "milestone";
            referencedColumns: ["project_id", "milestone_no"];
          },
          {
            foreignKeyName: "claim_team_id_project_id_fkey";
            columns: ["team_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "team";
            referencedColumns: ["team_id", "project_id"];
          },
          {
            foreignKeyName: "claim_team_id_project_id_fkey";
            columns: ["team_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "v_lab_cie_marks";
            referencedColumns: ["team_id", "project_id"];
          },
          {
            foreignKeyName: "claim_team_id_project_id_fkey";
            columns: ["team_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "v_rubric_sheet";
            referencedColumns: ["team_id", "project_id"];
          },
          {
            foreignKeyName: "claim_usn_fkey";
            columns: ["usn"];
            isOneToOne: false;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
        ];
      };
      v_faculty_team_progress: {
        Row: {
          artifacts: number | null;
          claims_confirmed: number | null;
          claims_contested: number | null;
          claims_pending: number | null;
          contributions: number | null;
          last_activity: string | null;
          max_size: number;
          members: number | null;
          project_id: string;
          project_title: string;
          submissions: number | null;
          team_id: string;
          team_name: string;
        };
        ComputedFields: never;
        Relationships: [];
      };
      v_lab_cie_marks: {
        Row: {
          components_assessed: number | null;
          final_10: number | null;
          innovative_10: number | null;
          name: string;
          project_id: string;
          raw_max: number | null;
          raw_total: number | null;
          reduced_30: number | null;
          team_id: string;
          total_50: number | null;
          usn: string;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "team_member_usn_fkey";
            columns: ["usn"];
            isOneToOne: false;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
          {
            foreignKeyName: "team_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "project";
            referencedColumns: ["project_id"];
          },
          {
            foreignKeyName: "team_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "v_faculty_team_progress";
            referencedColumns: ["project_id"];
          },
          {
            foreignKeyName: "team_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "v_semester_hub";
            referencedColumns: ["project_id"];
          },
        ];
      };
      v_rubric_sheet: {
        Row: {
          assessed_by: string | null;
          claims_confirmed: number | null;
          claims_contested: number | null;
          claims_pending: number | null;
          component: string;
          counts_in_reduced: boolean | null;
          deadline: string;
          locked: boolean | null;
          marks: number | null;
          max_marks: number;
          milestone_no: number;
          name: string;
          project_id: string;
          team_id: string;
          team_name: string;
          usn: string;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "assessment_assessed_by_fkey";
            columns: ["assessed_by"];
            isOneToOne: false;
            referencedRelation: "faculty";
            referencedColumns: ["faculty_id"];
          },
          {
            foreignKeyName: "team_member_usn_fkey";
            columns: ["usn"];
            isOneToOne: false;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
          {
            foreignKeyName: "team_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "project";
            referencedColumns: ["project_id"];
          },
          {
            foreignKeyName: "team_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "v_faculty_team_progress";
            referencedColumns: ["project_id"];
          },
          {
            foreignKeyName: "team_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "v_semester_hub";
            referencedColumns: ["project_id"];
          },
        ];
      };
      v_semester_hub: {
        Row: {
          course_code: string;
          course_title: string;
          faculty_name: string;
          is_current_term: boolean | null;
          my_claims_confirmed: number | null;
          my_claims_contested: number | null;
          my_claims_pending: number | null;
          next_component: string | null;
          next_deadline: string | null;
          next_milestone_no: number | null;
          offering_id: number;
          project_id: string | null;
          project_status: string | null;
          project_title: string | null;
          section: string;
          team_id: string | null;
          team_name: string | null;
          team_role: string | null;
          term_id: string;
          usn: string;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "course_offering_course_code_fkey";
            columns: ["course_code"];
            isOneToOne: false;
            referencedRelation: "course";
            referencedColumns: ["course_code"];
          },
          {
            foreignKeyName: "course_offering_term_id_fkey";
            columns: ["term_id"];
            isOneToOne: false;
            referencedRelation: "academic_term";
            referencedColumns: ["term_id"];
          },
          {
            foreignKeyName: "enrollment_usn_fkey";
            columns: ["usn"];
            isOneToOne: false;
            referencedRelation: "student";
            referencedColumns: ["usn"];
          },
        ];
      };
      v_what_faculty_sees: {
        Row: {
          ai_assistance: string | null;
          at: string | null;
          item_kind: string | null;
          item_ref: string | null;
          label: string | null;
          milestone_no: number | null;
          project_id: string | null;
          team_id: string | null;
          visibility: string | null;
        };
        ComputedFields: never;
        Relationships: [];
      };
    };
    Functions: {
      add_claim_evidence: {
        Args: { p_claim_id: number; p_kind: string; p_note?: string; p_ref: string };
        Returns: Json;
      };
      countersign_claim: {
        Args: {
          p_claim_id: number;
          p_claim_revision?: number;
          p_comment?: string;
          p_verdict: string;
        };
        Returns: Json;
      };
      delete_private_note: { Args: { p_note_id: number }; Returns: Json };
      file_claim: {
        Args: {
          p_ai_assistance?: string;
          p_artifact_id?: string;
          p_contribution_type: string;
          p_description: string;
          p_milestone_no: number;
          p_project_id: string;
        };
        Returns: Json;
      };
      find_full_cover: { Args: { p_project_id: string }; Returns: Json };
      find_teammates: { Args: { p_project_id: string }; Returns: Json };
      ingest_fail: {
        Args: { p_delivery_id: string; p_error: string; p_max_attempts?: number };
        Returns: Json;
      };
      ingest_mark_raw: { Args: { p_delivery_id: string; p_mongo_id: string }; Returns: Json };
      ingest_read: {
        Args: { p_qty?: number; p_vt?: number };
        Returns: {
          commit_authors: Json;
          delivery_id: string;
          event_type: string;
          msg_id: number;
          payload: Json;
          read_ct: number;
          team_id: string;
        }[];
      };
      ingest_receive: {
        Args: { p_delivery_id: string; p_event_type: string; p_payload: Json };
        Returns: Json;
      };
      join_team: { Args: { p_team_id: string }; Returns: Json };
      leave_team: { Args: { p_team_id: string }; Returns: Json };
      lock_milestone: { Args: { p_milestone_no: number; p_project_id: string }; Returns: Json };
      my_private_notes: { Args: Record<PropertyKey, never>; Returns: Json };
      project_push: {
        Args: { p_delivery_id: string; p_mongo_id?: string; p_payload: Json };
        Returns: Json;
      };
      record_assessment: {
        Args: {
          p_marks: number;
          p_milestone_no: number;
          p_project_id: string;
          p_remarks?: string;
          p_usn: string;
        };
        Returns: Json;
      };
      save_private_note: {
        Args: { p_body: string; p_note_id?: number; p_team_id?: string; p_title: string };
        Returns: Json;
      };
      search_chunks: {
        Args: {
          p_author_usn?: string;
          p_limit?: number;
          p_query: string;
          p_query_embedding?: string;
          p_since?: string;
          p_team_id?: string;
        };
        Returns: {
          artifact_id: string;
          artifact_title: string;
          artifact_type: string;
          author_name: string;
          author_usn: string;
          chunk_id: number;
          chunk_no: number;
          created_at: string;
          project_id: string;
          rank_fts: number;
          rank_vec: number;
          score: number;
          snippet: string;
          team_id: string;
          version_no: number;
          visibility: string;
        }[];
      };
      semester_hub: { Args: Record<PropertyKey, never>; Returns: Json };
      skill_gap: { Args: { p_project_id: string; p_usn?: string }; Returns: Json };
      skill_subtree: { Args: { p_skill_id: string }; Returns: Json };
      submit_milestone: {
        Args: { p_artifact_ids: string[]; p_milestone_no: number; p_team_id: string };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
