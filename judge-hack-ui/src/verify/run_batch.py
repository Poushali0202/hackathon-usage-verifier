"""Shim so engine.py / extract.py can `import run_batch` inside the Daytona sandbox."""
import re


def parse_repo(url):
    m = re.search(r"github\.com[/:]+([^/\s]+)/([^/\s#?]+)", url, re.I)
    return (m.group(1), m.group(2).removesuffix(".git")) if m else None


OTHER_PLATFORMS = ["butterbase", "supabase", "xtrace", "photon", "langchain",
                   "crewai", "firebase", "pinecone", "weaviate"]
